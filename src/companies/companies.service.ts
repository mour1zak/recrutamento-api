import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CEP_UNAVAILABLE_WARNING, CepService } from '../common/cep/cep.service.js';
import { errorBody } from '../common/exceptions/error-body.util.js';
import { isAdmin } from '../common/utils/role.util.js';
import { ApplicationStatus, JobStatus } from '../generated/prisma/client.js';
import type { AuthenticatedUser } from '../common/types/authenticated-user.js';
import { CreateCompanyDto } from './dto/create-company.dto.js';
import { UpdateCompanyDto } from './dto/update-company.dto.js';

function normalizeCnpj(cnpj: string): string {
  return cnpj.replace(/\D/g, '');
}

function cepInvalidError() {
  return new BadRequestException(errorBody(400, 'cep_nao_encontrado', 'CEP informado não existe.'));
}

@Injectable()
export class CompaniesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cepService: CepService,
  ) {}

  async create(dto: CreateCompanyDto) {
    // Achado Qwen rodada 11 (N1): CEP explicitamente inválido (provedor
    // confirma que não existe) é erro de quem enviou, não falha
    // transitória — rejeita a criação (PARECER-DEEPSEEK-FASE1.md §5,
    // cenário 2). Só uma falha de REDE/timeout ("unavailable") não bloqueia
    // a operação (cenários 4-7 do mesmo parecer).
    const resolution = await this.cepService.resolve(dto.cep);
    if (resolution.status === 'invalid') {
      throw cepInvalidError();
    }

    // Sem checagem prévia de "CNPJ já existe" (mesmo padrão de
    // createCandidate em users.service.ts): checar-então-criar tem janela
    // de corrida. O `@@unique(cnpj)` do banco garante a regra; o P2002
    // vira 409 com reason "cnpj_duplicado" no GlobalExceptionFilter.
    const company = await this.prisma.company.create({
      data: {
        name: dto.name,
        cnpj: dto.cnpj ? normalizeCnpj(dto.cnpj) : undefined,
        description: dto.description,
        cep: dto.cep,
        street: resolution.street,
        city: resolution.city,
        state: resolution.state,
      },
    });
    // Achado Qwen rodada 11: o "+ aviso" que o parecer da Fase 1 já pedia
    // pros cenários de indisponibilidade nunca tinha sido implementado —
    // campo extra na resposta, não persistido, só pra sinalizar ao
    // cliente que o endereço pode estar incompleto por falha externa.
    return resolution.status === 'unavailable' ? { ...company, addressWarning: CEP_UNAVAILABLE_WARNING } : company;
  }

  async findActiveOrThrow(id: number) {
    const company = await this.prisma.company.findUnique({ where: { id } });
    if (!company || !company.isActive) {
      throw new NotFoundException(errorBody(404, 'company_not_found', 'Empresa não encontrada.'));
    }
    return company;
  }

  async update(id: number, dto: UpdateCompanyDto) {
    await this.findActiveOrThrow(id);

    // Achado Qwen rodada 11 (N1): a correção da rodada 10 ("preserva
    // endereço se a consulta não resolveu nada") tratava CEP inválido e
    // falha de rede da mesma forma — permitindo salvar um `cep` novo com o
    // `street/city/state` do endereço ANTIGO, um par inconsistente. Agora
    // só "unavailable" preserva; "invalid" rejeita a atualização inteira,
    // igual à criação.
    const resolution = dto.cep ? await this.cepService.resolve(dto.cep) : undefined;
    if (resolution?.status === 'invalid') {
      throw cepInvalidError();
    }

    const company = await this.prisma.company.update({
      where: { id },
      data: {
        name: dto.name,
        cnpj: dto.cnpj ? normalizeCnpj(dto.cnpj) : undefined,
        description: dto.description,
        cep: dto.cep,
        ...(resolution?.status === 'ok' ? { street: resolution.street, city: resolution.city, state: resolution.state } : {}),
      },
    });
    return resolution?.status === 'unavailable' ? { ...company, addressWarning: CEP_UNAVAILABLE_WARNING } : company;
  }

  async deactivate(id: number) {
    const company = await this.prisma.company.findUnique({ where: { id } });
    if (!company) {
      throw new NotFoundException(errorBody(404, 'company_not_found', 'Empresa não encontrada.'));
    }
    if (!company.isActive) {
      // Achado Qwen rodada 8 (ressalva 6): o recurso EXISTE — o problema
      // é de estado, não de existência. Pela política do próprio projeto
      // (404 = não existe/é de terceiro; 409 = regra de negócio), isto é
      // 409, não 404. Como `404` era o único lugar em que o `reason`
      // permitia distinguir "não existe" de "existe e está inativa", a
      // troca também fecha um canal de enumeração (baixa severidade, já
      // que a rota é só ADMIN, mas o defeito de contrato era o mesmo).
      throw new ConflictException(errorBody(409, 'company_already_inactive', 'Empresa já está inativa.'));
    }

    // Achado Qwen rodada 3 (C5): desativar empresa é soft-delete, nunca
    // DELETE físico — preserva a evidência de quem foi recrutador dela.
    // Não cascateia pra vagas/usuários (decisão registrada no README):
    // Job.companyId e User.companyId continuam apontando pra empresa
    // inativa, e é responsabilidade do módulo de Jobs tratar isso quando
    // existir.
    return this.prisma.company.update({ where: { id }, data: { isActive: false } });
  }

  async reactivate(id: number) {
    const company = await this.prisma.company.findUnique({ where: { id } });
    if (!company) {
      throw new NotFoundException(errorBody(404, 'company_not_found', 'Empresa não encontrada.'));
    }
    if (company.isActive) {
      // Mesmo raciocínio do `deactivate()` acima (achado Qwen rodada 8,
      // ressalva 6): recurso existe, é conflito de estado -> 409.
      throw new ConflictException(errorBody(409, 'company_already_active', 'Empresa já está ativa.'));
    }

    return this.prisma.company.update({ where: { id }, data: { isActive: true } });
  }

  // Bônus "indicadores do domínio" (enunciado §Bônus) — diferente da
  // observabilidade de infraestrutura (Loki/Grafana, logs HTTP), isto é
  // métrica de NEGÓCIO: quantas vagas em cada status, o funil de
  // candidaturas, taxa de conversão e tempo médio até contratação.
  // RECRUITER só vê a própria empresa (mesmo padrão anti-enumeração do
  // resto do projeto: empresa de terceiro dá `404`, nunca `403`) — dados
  // agregados de contratação são informação competitiva, mais sensível
  // que o nome/endereço que `GET /companies/:id` já expõe sem escopo.
  async getStats(companyId: number, currentUser: AuthenticatedUser) {
    const company = await this.prisma.company.findUnique({ where: { id: companyId } });
    if (!company || !company.isActive || (!isAdmin(currentUser) && company.id !== currentUser.companyId)) {
      throw new NotFoundException(errorBody(404, 'company_not_found', 'Empresa não encontrada.'));
    }

    const [jobsByStatusRaw, applicationsByStatusRaw, hireHistory] = await Promise.all([
      this.prisma.job.groupBy({ by: ['status'], where: { companyId }, _count: { _all: true } }),
      this.prisma.application.groupBy({ by: ['status'], where: { job: { companyId } }, _count: { _all: true } }),
      this.prisma.applicationStatusHistory.findMany({
        where: { toStatus: ApplicationStatus.HIRED, application: { job: { companyId } } },
        select: { createdAt: true, application: { select: { createdAt: true } } },
      }),
    ]);

    const jobsByStatus = Object.fromEntries(Object.values(JobStatus).map((status) => [status, 0])) as Record<JobStatus, number>;
    for (const row of jobsByStatusRaw) jobsByStatus[row.status] = row._count._all;

    const applicationsByStatus = Object.fromEntries(Object.values(ApplicationStatus).map((status) => [status, 0])) as Record<ApplicationStatus, number>;
    for (const row of applicationsByStatusRaw) applicationsByStatus[row.status] = row._count._all;

    const totalApplications = Object.values(applicationsByStatus).reduce((sum, n) => sum + n, 0);
    const hiredCount = applicationsByStatus[ApplicationStatus.HIRED];
    const conversionRate = totalApplications > 0 ? Number((hiredCount / totalApplications).toFixed(4)) : null;

    const avgTimeToHireDays =
      hireHistory.length > 0
        ? Number(
            (
              hireHistory.reduce((sum, h) => sum + (h.createdAt.getTime() - h.application.createdAt.getTime()), 0) /
              hireHistory.length /
              (1000 * 60 * 60 * 24)
            ).toFixed(2),
          )
        : null;

    return {
      companyId,
      jobs: { total: Object.values(jobsByStatus).reduce((sum, n) => sum + n, 0), byStatus: jobsByStatus },
      applications: { total: totalApplications, byStatus: applicationsByStatus, conversionRate, avgTimeToHireDays },
    };
  }
}
