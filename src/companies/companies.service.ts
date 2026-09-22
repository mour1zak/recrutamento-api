import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CepService, isResolvedAddress } from '../common/cep/cep.service.js';
import { errorBody } from '../common/exceptions/error-body.util.js';
import { CreateCompanyDto } from './dto/create-company.dto.js';
import { UpdateCompanyDto } from './dto/update-company.dto.js';

function normalizeCnpj(cnpj: string): string {
  return cnpj.replace(/\D/g, '');
}

@Injectable()
export class CompaniesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cepService: CepService,
  ) {}

  async create(dto: CreateCompanyDto) {
    // Falha de CEP nunca bloqueia a criação (ver CepService) — endereço
    // fica null e a empresa é criada normalmente.
    const address = await this.cepService.resolve(dto.cep);

    // Sem checagem prévia de "CNPJ já existe" (mesmo padrão de
    // createCandidate em users.service.ts): checar-então-criar tem janela
    // de corrida. O `@@unique(cnpj)` do banco garante a regra; o P2002
    // vira 409 com reason "cnpj_duplicado" no GlobalExceptionFilter.
    return this.prisma.company.create({
      data: {
        name: dto.name,
        cnpj: dto.cnpj ? normalizeCnpj(dto.cnpj) : undefined,
        description: dto.description,
        cep: dto.cep,
        street: address.street,
        city: address.city,
        state: address.state,
      },
    });
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

    const address = dto.cep ? await this.cepService.resolve(dto.cep) : undefined;
    // Achado Qwen rodada 10 (ressalva 1, mesmo padrão de
    // CandidateProfile): uma falha transitória do ViaCEP durante um
    // UPDATE não pode apagar um endereço bom já salvo — só sobrescreve
    // se a consulta realmente resolveu algo.
    const resolvedAddress = address && isResolvedAddress(address) ? address : undefined;

    return this.prisma.company.update({
      where: { id },
      data: {
        name: dto.name,
        cnpj: dto.cnpj ? normalizeCnpj(dto.cnpj) : undefined,
        description: dto.description,
        cep: dto.cep,
        ...(resolvedAddress ? { street: resolvedAddress.street, city: resolvedAddress.city, state: resolvedAddress.state } : {}),
      },
    });
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
}
