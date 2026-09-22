import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { errorBody } from '../common/exceptions/error-body.util.js';
import { JobStatus, Prisma } from '../generated/prisma/client.js';
import { PERMISSIONS, SYSTEM_ROLES } from '../common/constants/permissions.constants.js';
import type { AuthenticatedUser } from '../common/types/authenticated-user.js';
import { CreateJobDto } from './dto/create-job.dto.js';
import { UpdateJobDto } from './dto/update-job.dto.js';
import { UpdateJobStatusDto } from './dto/update-job-status.dto.js';
import { ListJobsQueryDto } from './dto/list-jobs-query.dto.js';
import { ListMineJobsQueryDto } from './dto/list-mine-jobs-query.dto.js';

// Transições válidas de status (Fase 1, PARECER-DEEPSEEK-FASE1.md §3,
// fluxo expandido). CLOSED/CANCELED são terminais — nenhuma saída.
// OPEN -> CANCELED não estava no fluxo original documentado na Fase 1;
// incluído aqui por ser uma necessidade de negócio óbvia (cancelar uma
// vaga aberta) — registrar se o Qwen/DeepSeek discordar.
const VALID_TRANSITIONS: Record<JobStatus, JobStatus[]> = {
  DRAFT: ['OPEN', 'CANCELED'],
  OPEN: ['PAUSED', 'FILLED', 'CANCELED'],
  PAUSED: ['OPEN', 'CANCELED'],
  FILLED: ['CLOSED'],
  CLOSED: [],
  CANCELED: [],
};

function jobNotFound() {
  return new NotFoundException(errorBody(404, 'job_not_found', 'Vaga não encontrada.'));
}

// `companyId: null` hoje só acontece com ADMIN (RECRUITER sempre tem uma
// empresa) — tratado como "acesso a qualquer empresa", coerente com o
// papel de operação global do ADMIN, e não precisa checar a permission
// key aqui de novo: quem chama já passou pelo `@Permissions()` do
// controller antes de chegar neste método.
function isInScope(job: { companyId: number }, user: AuthenticatedUser): boolean {
  return user.companyId === null || user.companyId === job.companyId;
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
    });
  }

  private async resolveCompanyIdForCreate(dtoCompanyId: number | undefined, currentUser: AuthenticatedUser): Promise<number> {
    // RECRUITER: a vaga é sempre da própria empresa. Se mandar um
    // companyId diferente do seu, tratamos como "empresa de terceiro" —
    // 404, não 403 (política P4 da Fase 1: nunca confirmar/negar
    // existência de recurso fora do escopo de quem pergunta).
    if (currentUser.companyId !== null) {
      if (dtoCompanyId !== undefined && dtoCompanyId !== currentUser.companyId) {
        throw jobNotFound();
      }
      return currentUser.companyId;
    }

    // ADMIN: não tem empresa própria, precisa informar qual.
    if (dtoCompanyId === undefined) {
      throw new BadRequestException('companyId é obrigatório para ADMIN (sem empresa própria).');
    }
    const company = await this.prisma.company.findUnique({ where: { id: dtoCompanyId } });
    if (!company || !company.isActive) {
      throw new NotFoundException(errorBody(404, 'company_not_found', 'Empresa não encontrada.'));
    }
    return company.id;
  }

  async findPublicList(query: ListJobsQueryDto) {
    const where: Prisma.JobWhereInput = {
      status: JobStatus.OPEN,
      ...(query.search ? { title: { contains: query.search, mode: 'insensitive' } } : {}),
    };
    return this.paginate(where, query.page, query.limit);
  }

  async findMine(currentUser: AuthenticatedUser, query: ListMineJobsQueryDto) {
    // RECRUITER sem companyId não deveria existir no fluxo normal (todo
    // RECRUITER é criado já vinculado a uma empresa), mas é um estado
    // alcançável hoje: `User.companyId` usa `onDelete: SetNull` — se a
    // empresa dele for removida (soft-delete não afeta isso, mas nada
    // impede um `SetNull` futuro por outro caminho), o RECRUITER fica
    // "órfão". Tratado como 404 em vez de listar tudo, pra não misturar
    // com o comportamento de ADMIN (companyId null = acesso amplo).
    if (currentUser.companyId === null && currentUser.roleName !== SYSTEM_ROLES.ADMIN) {
      throw jobNotFound();
    }

    const where: Prisma.JobWhereInput = {
      ...(currentUser.companyId !== null ? { companyId: currentUser.companyId } : {}),
      ...(query.status ? { status: query.status } : {}),
    };
    return this.paginate(where, query.page, query.limit);
  }

  private async paginate(where: Prisma.JobWhereInput, page = 1, limit = 20) {
    const [total, data] = await Promise.all([
      this.prisma.job.count({ where }),
      this.prisma.job.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { createdAt: 'desc' } }),
    ]);
    return { data, page, limit, total };
  }

  async findOne(id: number, currentUser: AuthenticatedUser) {
    const job = await this.prisma.job.findUnique({ where: { id } });
    if (!job) {
      throw jobNotFound();
    }
    if (job.status === JobStatus.OPEN) {
      return job;
    }
    // Fora de OPEN, só quem tem `job:read:any` E é da mesma empresa (ou
    // ADMIN) enxerga — pra qualquer outro caso, 404 (nunca revela que a
    // vaga existe fora do estado público).
    if (currentUser.permissions.includes(PERMISSIONS.JOB_READ_ANY) && isInScope(job, currentUser)) {
      return job;
    }
    throw jobNotFound();
  }

  async update(id: number, dto: UpdateJobDto, currentUser: AuthenticatedUser) {
    const job = await this.findScopedOrThrow(id, currentUser);

    const nextVacancies = dto.vacancies ?? job.vacancies;
    if (nextVacancies < job.filledCount) {
      throw new ConflictException(
        errorBody(409, 'vacancies_below_filled_count', `Não é possível reduzir vagas abaixo do que já foi preenchido (${job.filledCount}).`),
      );
    }

    return this.prisma.job.update({
      where: { id },
      data: {
        title: dto.title,
        description: dto.description,
        vacancies: dto.vacancies,
        salaryMin: dto.salaryMin,
        salaryMax: dto.salaryMax,
        isRemote: dto.isRemote,
      },
    });
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

    return this.prisma.job.update({ where: { id }, data: { status: dto.status } });
  }

  private async findScopedOrThrow(id: number, currentUser: AuthenticatedUser) {
    const job = await this.prisma.job.findUnique({ where: { id } });
    if (!job || !isInScope(job, currentUser)) {
      throw jobNotFound();
    }
    return job;
  }
}
