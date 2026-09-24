import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { errorBody } from '../common/exceptions/error-body.util.js';
import { isAdmin } from '../common/utils/role.util.js';
import { isCompanyOperable } from '../common/utils/company-scope.util.js';
import { PERMISSIONS } from '../common/constants/permissions.constants.js';
import { ApplicationStatus, JobStatus, Prisma } from '../generated/prisma/client.js';
import type { AuthenticatedUser } from '../common/types/authenticated-user.js';
import { CreateApplicationDto } from './dto/create-application.dto.js';
import { UpdateApplicationStatusDto } from './dto/update-application-status.dto.js';
import { WithdrawApplicationDto } from './dto/withdraw-application.dto.js';
import { ListApplicationsQueryDto } from './dto/list-applications-query.dto.js';

// Fluxo de avaliação (definido na Fase 1 de modelagem, mais o enum do
// schema). Terminal: HIRED, REJECTED, WITHDRAWN — nenhuma saída. WITHDRAWN
// só é alcançável pela rota dedicada `/withdraw` (nunca aparece como
// destino de nenhuma transição aqui — o candidato desiste, o recrutador
// não "desiste por ele").
const VALID_TRANSITIONS: Record<ApplicationStatus, ApplicationStatus[]> = {
  PENDING: [ApplicationStatus.UNDER_REVIEW, ApplicationStatus.REJECTED],
  UNDER_REVIEW: [ApplicationStatus.INTERVIEW, ApplicationStatus.REJECTED],
  INTERVIEW: [ApplicationStatus.OFFERED, ApplicationStatus.REJECTED],
  OFFERED: [ApplicationStatus.HIRED, ApplicationStatus.REJECTED],
  HIRED: [],
  REJECTED: [],
  WITHDRAWN: [],
};

// Mesma lista positiva usada em CandidateProfile (achado da revisão técnica,
// C2) — reaproveitada aqui de propósito: é a mesma pergunta de negócio
// ("este status representa avaliação em andamento?"), então usar a mesma
// forma (lista positiva, não negação) evita reintroduzir o mesmo bug numa
// terceira leitura condicional de PII.
const STATUSES_WITH_FULL_VISIBILITY: ApplicationStatus[] = [
  ApplicationStatus.UNDER_REVIEW,
  ApplicationStatus.INTERVIEW,
  ApplicationStatus.OFFERED,
  ApplicationStatus.HIRED,
];

const TERMINAL_STATUSES: ApplicationStatus[] = [ApplicationStatus.HIRED, ApplicationStatus.REJECTED, ApplicationStatus.WITHDRAWN];

const APPLICATION_INCLUDE = {
  job: { select: { id: true, title: true, companyId: true, status: true, vacancies: true, filledCount: true } },
  candidate: { select: { id: true, name: true } },
  resumeDocument: { select: { id: true, filename: true, mimeType: true, sizeBytes: true } },
} as const;

type ApplicationWithRelations = Prisma.ApplicationGetPayload<{ include: typeof APPLICATION_INCLUDE }>;

function applicationNotFound() {
  return new NotFoundException(errorBody(404, 'application_not_found', 'Candidatura não encontrada.'));
}

function toFullResponse(application: ApplicationWithRelations) {
  return application;
}

async function toReducedResponse(prisma: PrismaService, application: ApplicationWithRelations) {
  // Achado Fase 1 (Pergunta 2 da especificação de negócio): antes de a candidatura sair de
  // PENDING, o recrutador vê só o mínimo pra triagem — cobertura +
  // documento (o candidato mandou de propósito pra essa vaga), mais
  // nome/headline/skills do perfil (mesma redução de CandidateProfile).
  const profile = await prisma.candidateProfile.findUnique({
    where: { userId: application.candidateId },
    select: { headline: true, skills: true },
  });
  return {
    id: application.id,
    jobId: application.jobId,
    status: application.status,
    coverLetter: application.coverLetter,
    resumeDocument: application.resumeDocument,
    createdAt: application.createdAt,
    candidate: {
      id: application.candidate.id,
      name: application.candidate.name,
      headline: profile?.headline ?? null,
      skills: profile?.skills ?? [],
    },
  };
}

@Injectable()
export class ApplicationsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(jobId: number, dto: CreateApplicationDto, currentUser: AuthenticatedUser) {
    const job = await this.prisma.job.findUnique({ where: { id: jobId }, include: { company: { select: { isActive: true } } } });
    // Mesma regra de visibilidade pública usada em JobsService.findOne():
    // vaga inexistente OU empresa desativada não são distinguíveis por
    // fora — as duas viram 404 (a candidatura nunca "descobre" uma
    // empresa desativada por diferença no formato do erro).
    if (!job || !job.company.isActive) {
      throw applicationJobNotFound();
    }
    if (job.status !== JobStatus.OPEN) {
      throw new ConflictException(errorBody(409, 'job_not_open', 'Esta vaga não está aberta para candidaturas.'));
    }

    if (dto.resumeDocumentId !== undefined) {
      await this.assertOwnDocumentOrThrow(dto.resumeDocumentId, currentUser.id);
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const application = await tx.application.create({
          data: {
            jobId,
            candidateId: currentUser.id,
            coverLetter: dto.coverLetter,
            resumeDocumentId: dto.resumeDocumentId,
          },
          include: APPLICATION_INCLUDE,
        });
        await tx.applicationStatusHistory.create({
          data: { applicationId: application.id, fromStatus: null, toStatus: ApplicationStatus.PENDING, changedById: currentUser.id },
        });
        return application;
      });
    } catch (error) {
      // Regra obrigatória do enunciado: candidatura duplicada proibida.
      // `@@unique([candidateId, jobId])` garante a regra mesmo sob
      // corrida (dois cliques do mesmo candidato na mesma vaga); aqui só
      // traduzimos o `P2002` pro formato de erro do projeto.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException(errorBody(409, 'candidatura_duplicada', 'Você já se candidatou a esta vaga.'));
      }
      throw error;
    }
  }

  private async assertOwnDocumentOrThrow(documentId: number, candidateId: number): Promise<void> {
    // Pendência registrada desde a Fase 1:
    // `resumeDocument.ownerId === candidateId` não é enforçável só pela FK
    // — sem esta checagem, um candidato poderia anexar à própria
    // candidatura um documento de OUTRO usuário só sabendo o id (IDOR).
    const document = await this.prisma.document.findUnique({ where: { id: documentId }, select: { ownerId: true } });
    if (!document || document.ownerId !== candidateId) {
      throw new BadRequestException(errorBody(400, 'resume_document_invalido', 'resumeDocumentId inválido ou não pertence a você.'));
    }
  }

  async findMine(currentUser: AuthenticatedUser, query: ListApplicationsQueryDto) {
    const where: Prisma.ApplicationWhereInput = {
      candidateId: currentUser.id,
      ...(query.status ? { status: query.status } : {}),
    };
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const [total, data] = await Promise.all([
      this.prisma.application.count({ where }),
      this.prisma.application.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { createdAt: query.sortOrder ?? 'desc' }, include: APPLICATION_INCLUDE }),
    ]);
    return { data, page, limit, total };
  }

  async findForJob(jobId: number, currentUser: AuthenticatedUser, query: ListApplicationsQueryDto) {
    const job = await this.prisma.job.findUnique({ where: { id: jobId }, select: { companyId: true } });
    // Mesmo padrão anti-enumeração de `JobsService`: vaga fora do escopo
    // do recrutador é 404, nunca 403 (não confirma nem nega existência).
    // Achado CRÍTICO da revisão técnica (K5): faltava checar se a empresa do
    // recrutador ainda está ATIVA — `isCompanyOperable()` foi extraído
    // anteriormente exatamente pra este consumidor e nunca foi importado
    // aqui. Sem isso, um recrutador de empresa desativada continuava
    // lendo candidaturas normalmente (medido: 200 onde `Jobs`/
    // `CandidateProfile` já dão 404 pro mesmo cenário).
    if (!job || (!isAdmin(currentUser) && (job.companyId !== currentUser.companyId || !(await isCompanyOperable(this.prisma, currentUser.companyId))))) {
      throw applicationJobNotFound();
    }

    const where: Prisma.ApplicationWhereInput = { jobId, ...(query.status ? { status: query.status } : {}) };
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const [total, data] = await Promise.all([
      this.prisma.application.count({ where }),
      this.prisma.application.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { createdAt: query.sortOrder ?? 'desc' }, include: APPLICATION_INCLUDE }),
    ]);
    return { data, page, limit, total };
  }

  async findOne(id: number, currentUser: AuthenticatedUser) {
    // Sem `@Permissions()` no controller (o guard só faz E, esta rota
    // precisa de OU) — checa aqui se pelo menos uma das três keys que dão
    // acesso a este endpoint está presente, no mesmo formato de 403 que o
    // guard usaria.
    const hasAnyReadPermission =
      currentUser.permissions.includes(PERMISSIONS.APPLICATION_READ_OWN) ||
      currentUser.permissions.includes(PERMISSIONS.APPLICATION_READ_JOB) ||
      currentUser.permissions.includes(PERMISSIONS.APPLICATION_READ_ANY);
    if (!hasAnyReadPermission) {
      throw new ForbiddenException(errorBody(403, 'permission_denied', 'Você não tem permissão para executar esta ação.'));
    }

    const application = await this.prisma.application.findUnique({ where: { id }, include: APPLICATION_INCLUDE });
    if (!application) {
      throw applicationNotFound();
    }

    if (application.candidateId === currentUser.id || isAdmin(currentUser)) {
      return toFullResponse(application);
    }

    // RECRUITER: só enxerga candidatura de vaga da própria empresa, com a
    // empresa ainda ATIVA — fora disso, 404 (mesma política
    // anti-enumeração do resto do projeto, nunca 403). Achado CRÍTICO
    // da revisão técnica (K5): a checagem de empresa ativa faltava aqui.
    if (application.job.companyId !== currentUser.companyId || !(await isCompanyOperable(this.prisma, currentUser.companyId))) {
      throw applicationNotFound();
    }
    return STATUSES_WITH_FULL_VISIBILITY.includes(application.status)
      ? toFullResponse(application)
      : toReducedResponse(this.prisma, application);
  }

  async updateStatus(id: number, dto: UpdateApplicationStatusDto, currentUser: AuthenticatedUser) {
    const application = await this.findScopedForRecruiterOrThrow(id, currentUser);

    const allowed = VALID_TRANSITIONS[application.status];
    if (!allowed.includes(dto.status)) {
      throw new BadRequestException(
        errorBody(400, 'invalid_status_transition', `Não é possível mudar de "${application.status}" para "${dto.status}".`),
      );
    }

    if (dto.status === ApplicationStatus.HIRED) {
      return this.hireWithCapacityCheck(application, dto, currentUser);
    }

    // Mesmo primitivo já provado em Auth (refresh) e Jobs (updateStatus):
    // escrita condicionada ao estado lido — se outra transição já mudou o
    // status entre a leitura e esta escrita, `count === 0` vira `409` em
    // vez de aplicar por cima.
    const result = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.application.updateMany({ where: { id, status: application.status }, data: { status: dto.status } });
      if (updated.count > 0) {
        await tx.applicationStatusHistory.create({
          data: { applicationId: id, fromStatus: application.status, toStatus: dto.status, changedById: currentUser.id, note: dto.reason },
        });
      }
      return updated;
    });
    if (result.count === 0) {
      throw new ConflictException(
        errorBody(409, 'application_status_changed_concurrently', 'O status da candidatura mudou antes que esta operação fosse aplicada. Busque o estado atual (GET) antes de tentar de novo.'),
      );
    }
    return this.prisma.application.findUniqueOrThrow({ where: { id }, include: APPLICATION_INCLUDE });
  }

  // Achado CRÍTICO da revisão técnica (K1): a versão anterior comparava
  // `filledCount` (coluna, valor no instante da escrita) contra
  // `application.job.vacancies` — um NÚMERO lido ANTES desta transação
  // começar, não a coluna `vacancies` em si. Enquanto `vacancies` não
  // muda no meio do caminho, as duas comparações coincidem — foi por
  // isso que o teste original (2 requisições, vacancies estável) passou.
  // Medido na revisão técnica: reduzir `vacancies` (`PATCH /jobs/:id`) ENQUANTO
  // uma contratação está em voo faz a comparação usar o valor antigo
  // (maior), e a escrita passa mesmo violando o invariante — 15/25
  // corridas produziram `filledCount > vacancies`. A API do Prisma não
  // expressa comparação coluna×coluna; corrigido com SQL parametrizado
  // (`$queryRaw`, sem interpolação de string — os `${}` do `Prisma.sql`
  // viram parâmetros reais, não concatenação). `RETURNING` devolve o
  // estado JÁ atualizado na mesma instrução, evitando uma segunda leitura
  // (que voltaria a ser um valor "lido antes", o mesmo defeito do K1) —
  // e seleciona só as duas colunas necessárias (Gate Fase 3: "qualquer
  // `$queryRaw` usado no lock seleciona só o estritamente necessário").
  // `"updatedAt" = now()` setado à mão: esta é a única escrita SQL bruta
  // do projeto, e a coluna não tinha `DEFAULT`/trigger que a cobrisse
  // fora do Prisma Client (Gate Fase 3, achado ao fechar este gate:
  // migration `gate_fase3_updated_at_trigger_and_email_ci_index` deu a
  // TODAS as 7 tabelas com `updatedAt` um trigger `BEFORE UPDATE`; esta
  // escrita continua explícita por clareza, o trigger é a rede de
  // segurança pra qualquer SQL bruto futuro que esqueça).
  private async hireWithCapacityCheck(application: ApplicationWithRelations, dto: UpdateApplicationStatusDto, currentUser: AuthenticatedUser) {
    return this.prisma.$transaction(async (tx) => {
      // `now() AT TIME ZONE 'UTC'`, não `now()` puro: achado real (pego por
      // teste automatizado, não leitura de código) na migration
      // `fix_updated_at_trigger_timezone` — atribuir um `timestamptz` direto
      // a uma coluna `timestamp without time zone` faz o Postgres converter
      // pelo TimeZone DA SESSÃO (`America/Sao_Paulo` neste ambiente, UTC-3),
      // gravando hora local como se fosse UTC ingênuo. O Prisma Client
      // sempre escreve essa coluna em UTC — sem a conversão explícita, esta
      // única escrita SQL bruta do projeto ficava ~3h dessincronizada de
      // toda escrita feita pelo Prisma.
      const [jobRow] = await tx.$queryRaw<{ filledCount: number; vacancies: number }[]>`
        UPDATE "Job" SET "filledCount" = "filledCount" + 1, "updatedAt" = (now() AT TIME ZONE 'UTC')
        WHERE id = ${application.jobId} AND "filledCount" < "vacancies"
        RETURNING "filledCount", "vacancies"
      `;
      if (!jobRow) {
        throw new ConflictException(errorBody(409, 'no_vacancies_left', `A vaga já preencheu todas as ${application.job.vacancies} posições.`));
      }
      const appUpdate = await tx.application.updateMany({
        where: { id: application.id, status: application.status },
        data: { status: ApplicationStatus.HIRED },
      });
      if (appUpdate.count === 0) {
        throw new ConflictException(
          errorBody(409, 'application_status_changed_concurrently', 'O status da candidatura mudou antes que esta operação fosse aplicada. Busque o estado atual (GET) antes de tentar de novo.'),
        );
      }
      await tx.applicationStatusHistory.create({
        data: { applicationId: application.id, fromStatus: application.status, toStatus: ApplicationStatus.HIRED, changedById: currentUser.id, note: dto.reason },
      });

      // Gate Fase 3 (segunda invariante, registrada desde a Fase 1): o
      // contador `filledCount` sozinho pega o SINTOMA, não a causa — se
      // algum caminho futuro (bug, script de manutenção, SQL bruto novo)
      // incrementar o contador sem marcar a candidatura correspondente
      // como `HIRED` (ou vice-versa), o contador mentiria sem ninguém
      // perceber. Confere a CONTAGEM REAL de candidaturas `HIRED` desta
      // vaga contra `vacancies` antes de commitar — se divergir, reverte
      // a transação inteira (lançar aqui desfaz as duas escritas acima).
      const hiredCount = await tx.application.count({ where: { jobId: application.jobId, status: ApplicationStatus.HIRED } });
      if (hiredCount > jobRow.vacancies) {
        throw new ConflictException(
          errorBody(409, 'invariante_vagas_violada', 'Estado inconsistente detectado entre o contador de vagas e as candidaturas contratadas — operação revertida.'),
        );
      }

      return tx.application.findUniqueOrThrow({ where: { id: application.id }, include: APPLICATION_INCLUDE });
    });
  }

  async withdraw(id: number, dto: WithdrawApplicationDto, currentUser: AuthenticatedUser) {
    const application = await this.prisma.application.findUnique({ where: { id } });
    // Só o dono pode desistir da própria candidatura — outro candidato
    // tentando isso é tratado como "não encontrada" (nunca revela que a
    // candidatura existe e é de outra pessoa).
    if (!application || application.candidateId !== currentUser.id) {
      throw applicationNotFound();
    }
    if (TERMINAL_STATUSES.includes(application.status)) {
      throw new ConflictException(errorBody(409, 'application_ja_encerrada', 'Esta candidatura já está em um status final e não pode ser retirada.'));
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.application.updateMany({ where: { id, status: application.status }, data: { status: ApplicationStatus.WITHDRAWN } });
      if (updated.count > 0) {
        await tx.applicationStatusHistory.create({
          data: { applicationId: id, fromStatus: application.status, toStatus: ApplicationStatus.WITHDRAWN, changedById: currentUser.id, note: dto.reason },
        });
      }
      return updated;
    });
    if (result.count === 0) {
      throw new ConflictException(
        errorBody(409, 'application_status_changed_concurrently', 'O status da candidatura mudou antes que esta operação fosse aplicada. Busque o estado atual (GET) antes de tentar de novo.'),
      );
    }
    return this.prisma.application.findUniqueOrThrow({ where: { id }, include: APPLICATION_INCLUDE });
  }

  private async findScopedForRecruiterOrThrow(id: number, currentUser: AuthenticatedUser) {
    const application = await this.prisma.application.findUnique({ where: { id }, include: APPLICATION_INCLUDE });
    // Achado CRÍTICO da revisão técnica (K5): faltava `isCompanyOperable()` —
    // sem ela, um recrutador de empresa desativada continuava mudando o
    // status de candidaturas normalmente.
    if (!application || (!isAdmin(currentUser) && (application.job.companyId !== currentUser.companyId || !(await isCompanyOperable(this.prisma, currentUser.companyId))))) {
      throw applicationNotFound();
    }
    return application;
  }
}

function applicationJobNotFound() {
  return new NotFoundException(errorBody(404, 'job_not_found', 'Vaga não encontrada.'));
}
