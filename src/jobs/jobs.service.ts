import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { errorBody } from '../common/exceptions/error-body.util.js';
import { JobStatus, Prisma } from '../generated/prisma/client.js';
import { PERMISSIONS } from '../common/constants/permissions.constants.js';
import { isAdmin } from '../common/utils/role.util.js';
import type { AuthenticatedUser } from '../common/types/authenticated-user.js';
import { CreateJobDto } from './dto/create-job.dto.js';
import { UpdateJobDto } from './dto/update-job.dto.js';
import { UpdateJobStatusDto } from './dto/update-job-status.dto.js';
import { ListJobsQueryDto } from './dto/list-jobs-query.dto.js';
import { ListMineJobsQueryDto } from './dto/list-mine-jobs-query.dto.js';

// Transições válidas de status (Fase 1, PARECER-DEEPSEEK-FASE1.md §3,
// fluxo expandido, mais correções da rodada 8). CLOSED/CANCELED são
// terminais — nenhuma saída. Achado Qwen rodada 8 (R4): `OPEN -> CLOSED`
// tinha sido removido da tabela sem registro, contradizendo o comentário
// do próprio enum em schema.prisma ("CLOSED: encerrada definitivamente
// SEM preencher todas as vagas") — sem essa transição, CLOSED só era
// alcançável via FILLED, ou seja, só com todas as vagas preenchidas.
// Reincluída. `OPEN -> CANCELED` continua sendo adição nossa (não estava
// no fluxo original da Fase 1) — cancelar uma vaga aberta é necessidade
// óbvia de negócio.
const VALID_TRANSITIONS: Record<JobStatus, JobStatus[]> = {
  DRAFT: ['OPEN', 'CANCELED'],
  OPEN: ['PAUSED', 'FILLED', 'CLOSED', 'CANCELED'],
  PAUSED: ['OPEN', 'CANCELED'],
  FILLED: ['CLOSED'],
  CLOSED: [],
  CANCELED: [],
};

const PUBLIC_JOB_SELECT = {
  id: true,
  title: true,
  description: true,
  isRemote: true,
  salaryMin: true,
  salaryMax: true,
  vacancies: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  closedAt: true,
  // Achado Qwen rodada 8 (R1): antes, `GET /jobs` não trazia o nome da
  // empresa — o candidato via só `companyId` cru, sem rota pra resolver
  // isso. `R5`: `createdById` (id interno de User, enumerável) e
  // `filledCount` (contador de contratações) não pertencem a uma vitrine
  // pública, por isso ficam de fora deste `select` (mas continuam
  // presentes em `/jobs/mine` e `/jobs/:id` autenticado).
  company: { select: { id: true, name: true } },
} as const;

const SCOPED_JOB_INCLUDE = {
  company: { select: { id: true, name: true } },
} as const;

// Usado só internamente em `findOne()` — precisa de `isActive` pra decidir
// visibilidade pública (achado Qwen rodada 9, Q3/N8), mas o campo nunca
// sai na resposta (`stripCompanyIsActive` remove antes de devolver).
const SCOPED_JOB_INCLUDE_WITH_COMPANY_STATUS = {
  company: { select: { id: true, name: true, isActive: true } },
} as const;

function stripCompanyIsActive<T extends { company: { id: number; name: string; isActive: boolean } }>(
  job: T,
): Omit<T, 'company'> & { company: { id: number; name: string } } {
  const { company, ...rest } = job;
  return { ...rest, company: { id: company.id, name: company.name } };
}

function jobNotFound() {
  return new NotFoundException(errorBody(404, 'job_not_found', 'Vaga não encontrada.'));
}

// Achado crítico Qwen rodada 8 (C1): antes desta correção, "está dentro
// do escopo" tinha TRÊS respostas diferentes no mesmo arquivo —
// `isInScope()` e `resolveCompanyIdForCreate()` tratavam
// `companyId === null` como "acesso a qualquer empresa" (achando que só
// ADMIN chegava nesse estado), enquanto `findMine()` tratava do jeito
// certo (sem empresa E sem ser ADMIN = fora de escopo). O seed criava um
// RECRUITER sem `companyId`, com senha pública — combinação que dava
// acesso global a esse usuário. Agora só existe UM lugar que decide
// isso, usado por toda checagem de escopo do módulo.
function hasJobScope(job: { companyId: number }, user: AuthenticatedUser): boolean {
  return isAdmin(user) || user.companyId === job.companyId;
}

// Achado Qwen rodada 8 (R3): `%`/`_`/`\` no `search` não eram escapados
// antes do `contains` — `search=%25` (um `%` urlencoded) casava
// qualquer título, virando uma varredura completa disfarçada de busca.
function escapeLikeWildcards(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

@Injectable()
export class JobsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateJobDto, currentUser: AuthenticatedUser) {
    const companyId = await this.resolveCompanyIdForCreate(dto.companyId, currentUser);

    return this.prisma.job.create({
      data: {
        title: dto.title,
        description: dto.description,
        vacancies: dto.vacancies,
        salaryMin: dto.salaryMin,
        salaryMax: dto.salaryMax,
        isRemote: dto.isRemote,
        companyId,
        createdById: currentUser.id,
      },
      include: SCOPED_JOB_INCLUDE,
    });
  }

  private async resolveCompanyIdForCreate(dtoCompanyId: number | undefined, currentUser: AuthenticatedUser): Promise<number> {
    if (!isAdmin(currentUser)) {
      // Achado crítico Qwen rodada 8 (C1): esta checagem não existia.
      // Sem ela, qualquer usuário com `job:create` e `companyId: null`
      // (o RECRUITER do seed, antes desta rodada) caía direto no ramo
      // "ADMIN" abaixo e criava vaga em qualquer empresa ativa — provado
      // por execução: `POST /jobs {companyId: <empresa alheia>}` → `201`.
      if (currentUser.companyId === null) {
        throw jobNotFound();
      }
      // RECRUITER: a vaga é sempre da própria empresa. Se mandar um
      // companyId diferente do seu, tratamos como "empresa de terceiro"
      // — 404, não 403 (política P4 da Fase 1: nunca confirmar/negar
      // existência de recurso fora do escopo de quem pergunta).
      if (dtoCompanyId !== undefined && dtoCompanyId !== currentUser.companyId) {
        throw jobNotFound();
      }
      return this.assertCompanyActiveOrThrow(currentUser.companyId);
    }

    // ADMIN: não tem empresa própria, precisa informar qual.
    if (dtoCompanyId === undefined) {
      throw new BadRequestException('companyId é obrigatório para ADMIN (sem empresa própria).');
    }
    return this.assertCompanyActiveOrThrow(dtoCompanyId);
  }

  // Achado crítico Qwen rodada 8 (C3): antes, só o ramo ADMIN checava
  // `isActive` da empresa — um RECRUITER de empresa desativada continuava
  // criando/editando/publicando vagas normalmente, que apareciam na
  // vitrine pública, enquanto `GET /companies/:id` já dizia "não
  // encontrada" pra essa mesma empresa. Decisão explícita (uma das duas
  // que o Qwen ofereceu): checar `isActive` em toda ESCRITA de vaga
  // (create/update/updateStatus) — leituras de vagas já `OPEN` não são
  // afetadas retroativamente (desativar uma empresa não esconde vagas
  // já publicadas, só impede novas ações).
  private async assertCompanyActiveOrThrow(companyId: number): Promise<number> {
    const company = await this.prisma.company.findUnique({ where: { id: companyId } });
    if (!company || !company.isActive) {
      throw new NotFoundException(errorBody(404, 'company_not_found', 'Empresa não encontrada.'));
    }
    return company.id;
  }

  async findPublicList(query: ListJobsQueryDto) {
    const where: Prisma.JobWhereInput = {
      status: JobStatus.OPEN,
      // Achado Qwen rodada 9 (Q3/N8): sem isso, a vitrine pública
      // anunciava vagas de empresas desativadas — o candidato via o card,
      // clicava, e `GET /companies/:id` já respondia "não encontrada" pra
      // essa mesma empresa. Não afeta o dono (RECRUITER/ADMIN continuam
      // lendo o próprio histórico via `/jobs/mine` e `/jobs/:id`).
      company: { isActive: true },
      ...(query.search ? { title: { contains: escapeLikeWildcards(query.search), mode: 'insensitive' } } : {}),
    };
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const [total, data] = await Promise.all([
      this.prisma.job.count({ where }),
      this.prisma.job.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { createdAt: 'desc' }, select: PUBLIC_JOB_SELECT }),
    ]);
    return { data, page, limit, total };
  }

  async findMine(currentUser: AuthenticatedUser, query: ListMineJobsQueryDto) {
    // RECRUITER sem companyId não deveria existir no fluxo normal (todo
    // RECRUITER agora nasce vinculado a uma empresa — seed e Gate Fase 3
    // vão reforçar isso), mas seria um estado alcançável se alguém
    // desvinculasse via outro caminho. Tratado como 404 em vez de listar
    // tudo, pra não misturar com o comportamento de ADMIN.
    if (currentUser.companyId === null && !isAdmin(currentUser)) {
      throw jobNotFound();
    }

    const where: Prisma.JobWhereInput = {
      ...(currentUser.companyId !== null ? { companyId: currentUser.companyId } : {}),
      ...(query.status ? { status: query.status } : {}),
    };
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const [total, data] = await Promise.all([
      this.prisma.job.count({ where }),
      this.prisma.job.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { createdAt: 'desc' }, include: SCOPED_JOB_INCLUDE }),
    ]);
    return { data, page, limit, total };
  }

  async findOne(id: number, currentUser: AuthenticatedUser) {
    const job = await this.prisma.job.findUnique({ where: { id }, include: SCOPED_JOB_INCLUDE_WITH_COMPANY_STATUS });
    if (!job) {
      throw jobNotFound();
    }
    // Achado Qwen rodada 9 (Q3/N8): vaga OPEN só é publicamente visível
    // se a empresa dona também estiver ativa — antes, uma vaga OPEN de
    // empresa desativada continuava aparecendo pra qualquer um (mesmo
    // bug da vitrine, aqui na rota de detalhe). O dono (job:read:any +
    // mesma empresa) continua lendo o próprio histórico normalmente,
    // ativa ou não — ver ramo abaixo.
    if (job.status === JobStatus.OPEN && job.company.isActive) {
      return stripCompanyIsActive(job);
    }
    // Fora do caminho público, só quem tem `job:read:any` E é da mesma
    // empresa (ou ADMIN) enxerga — pra qualquer outro caso, 404 (nunca
    // revela que a vaga existe fora do estado público).
    if (currentUser.permissions.includes(PERMISSIONS.JOB_READ_ANY) && hasJobScope(job, currentUser)) {
      return stripCompanyIsActive(job);
    }
    throw jobNotFound();
  }

  async update(id: number, dto: UpdateJobDto, currentUser: AuthenticatedUser) {
    const job = await this.findScopedOrThrow(id, currentUser);
    const nextVacancies = dto.vacancies ?? job.vacancies;

    // Achado crítico Qwen rodada 8 (C2, mesma causa raiz aplicada aqui
    // por precaução): a versão anterior lia `job.filledCount` e escrevia
    // em passos separados — mesma forma que o C2 provou quebrar em
    // `updateStatus()`. `updateMany` condicionado ao estado que
    // justifica a escrita: só aplica se `filledCount` (o valor de
    // verdade no banco no momento da escrita, não o que foi lido antes)
    // ainda cabe dentro da nova `vacancies`.
    const result = await this.prisma.job.updateMany({
      where: { id, filledCount: { lte: nextVacancies } },
      data: {
        title: dto.title,
        description: dto.description,
        vacancies: dto.vacancies,
        salaryMin: dto.salaryMin,
        salaryMax: dto.salaryMax,
        isRemote: dto.isRemote,
      },
    });
    if (result.count === 0) {
      // Achado Qwen rodada 9 (N3): `count === 0` aqui tinha duas causas
      // possíveis (vaga saiu de escopo entre a leitura e a escrita, ou a
      // invariante de fato foi violada) mapeadas pro mesmo `reason` sem
      // distinção, e a mensagem tinha perdido os números concretos que a
      // versão anterior (não atômica) dava. Re-consulta pra dar a
      // resposta certa nos dois casos.
      const current = await this.prisma.job.findUnique({ where: { id } });
      if (!current || !hasJobScope(current, currentUser)) {
        throw jobNotFound();
      }
      throw new ConflictException(
        errorBody(
          409,
          'vacancies_below_filled_count',
          `Não é possível reduzir vagas para ${nextVacancies} — já foram preenchidas ${current.filledCount}.`,
        ),
      );
    }
    return this.prisma.job.findUniqueOrThrow({ where: { id }, include: SCOPED_JOB_INCLUDE });
  }

  async updateStatus(id: number, dto: UpdateJobStatusDto, currentUser: AuthenticatedUser) {
    const job = await this.findScopedOrThrow(id, currentUser);

    const allowed = VALID_TRANSITIONS[job.status];
    if (!allowed.includes(dto.status)) {
      throw new BadRequestException(
        errorBody(400, 'invalid_status_transition', `Não é possível mudar de "${job.status}" para "${dto.status}".`),
      );
    }

    if (dto.status === JobStatus.FILLED && job.filledCount < job.vacancies) {
      throw new ConflictException(
        errorBody(409, 'job_not_fully_filled', `A vaga só pode ser marcada como FILLED quando todas as ${job.vacancies} posições estiverem preenchidas (hoje: ${job.filledCount}).`),
      );
    }

    // Achado crítico Qwen rodada 8 (C2): medido, 13 em 25 corridas de
    // duas `PATCH .../status` simultâneas terminavam com um `CANCELED`
    // (terminal) sobrescrito por `PAUSED` — leitura-então-escrita em
    // passos separados, mesmo padrão que já causou o C4 (Fase 2, refresh
    // token) e o N1 (Fase 2, último admin). Corrigido com o mesmo
    // primitivo já provado em `AuthService.refresh()`: escrita
    // condicionada ao status que foi lido — se outra transição já mudou
    // o status entre a leitura e esta escrita, `count === 0` e devolve
    // `409` em vez de aplicar por cima.
    const result = await this.prisma.job.updateMany({
      where: { id, status: job.status },
      data: { status: dto.status },
    });
    if (result.count === 0) {
      // Achado Qwen rodada 9 (N4): a mensagem antiga dizia só "tente
      // novamente" — um retry ingênuo reenviando o mesmo `status` bate
      // numa transição que já não é mais válida a partir do estado atual
      // (ex.: pediu OPEN→PAUSED, chegou tarde, o status virou CANCELED —
      // reenviar "PAUSED" agora dá `400 invalid_status_transition`,
      // trocando um erro recuperável por um permanente). A mensagem agora
      // orienta reler o recurso antes de reenviar, não só "tente de novo".
      throw new ConflictException(
        errorBody(
          409,
          'status_changed_concurrently',
          'O status da vaga mudou antes que esta operação fosse aplicada. Busque o estado atual da vaga (GET) antes de tentar a transição de novo.',
        ),
      );
    }
    return this.prisma.job.findUniqueOrThrow({ where: { id }, include: SCOPED_JOB_INCLUDE });
  }

  private async findScopedOrThrow(id: number, currentUser: AuthenticatedUser) {
    const job = await this.prisma.job.findUnique({ where: { id }, include: { company: true } });
    if (!job || !hasJobScope(job, currentUser) || !job.company.isActive) {
      throw jobNotFound();
    }
    return job;
  }
}
