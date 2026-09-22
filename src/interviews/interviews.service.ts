import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { errorBody } from '../common/exceptions/error-body.util.js';
import { isAdmin } from '../common/utils/role.util.js';
import { ApplicationStatus, InterviewStatus } from '../generated/prisma/client.js';
import type { AuthenticatedUser } from '../common/types/authenticated-user.js';
import { CreateInterviewDto } from './dto/create-interview.dto.js';
import { UpdateInterviewDto } from './dto/update-interview.dto.js';

const INTERVIEW_INCLUDE = {
  application: { select: { id: true, status: true, candidateId: true, job: { select: { id: true, companyId: true } } } },
} as const;

function interviewNotFound() {
  return new NotFoundException(errorBody(404, 'interview_not_found', 'Entrevista não encontrada.'));
}

function applicationNotFound() {
  return new NotFoundException(errorBody(404, 'application_not_found', 'Candidatura não encontrada.'));
}

@Injectable()
export class InterviewsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(applicationId: number, dto: CreateInterviewDto, currentUser: AuthenticatedUser) {
    const application = await this.prisma.application.findUnique({
      where: { id: applicationId },
      select: { id: true, status: true, job: { select: { companyId: true } } },
    });
    if (!application || (!isAdmin(currentUser) && application.job.companyId !== currentUser.companyId)) {
      throw applicationNotFound();
    }
    // Contrato do DeepSeek (Fase 2, mapa §5): só se agenda entrevista
    // quando a candidatura já está na etapa de entrevista — evita marcar
    // entrevista pra quem ainda está em triagem (UNDER_REVIEW) ou já foi
    // rejeitado/contratado.
    if (application.status !== ApplicationStatus.INTERVIEW) {
      throw new ConflictException(
        errorBody(409, 'application_not_in_interview_stage', 'A candidatura precisa estar com status INTERVIEW para agendar uma entrevista.'),
      );
    }

    return this.prisma.interview.create({
      data: { applicationId, scheduledAt: new Date(dto.scheduledAt), interviewerId: dto.interviewerId },
    });
  }

  async findForApplication(applicationId: number, currentUser: AuthenticatedUser) {
    const application = await this.prisma.application.findUnique({ where: { id: applicationId }, select: { job: { select: { companyId: true } } } });
    if (!application || (!isAdmin(currentUser) && application.job.companyId !== currentUser.companyId)) {
      throw applicationNotFound();
    }
    return this.prisma.interview.findMany({ where: { applicationId }, orderBy: { createdAt: 'desc' } });
  }

  async findOne(id: number, currentUser: AuthenticatedUser) {
    const interview = await this.findScopedOrThrow(id, currentUser);
    const { application: _application, ...rest } = interview;
    return rest;
  }

  async update(id: number, dto: UpdateInterviewDto, currentUser: AuthenticatedUser) {
    const interview = await this.findScopedOrThrow(id, currentUser);

    // Só SCHEDULED tem saída — as outras 4 são terminais (achado registrado
    // no pacote DeepSeek: "interview:update em entrevista terminal" era
    // uma das decisões em aberto; optamos por 409, não permitir corrigir
    // feedback depois de encerrada, mesma postura de estado terminal já
    // usada em Jobs/Applications).
    if (interview.status !== InterviewStatus.SCHEDULED) {
      throw new ConflictException(errorBody(409, 'interview_ja_encerrada', 'Esta entrevista já está em um status final.'));
    }

    if (dto.status === InterviewStatus.RESCHEDULED) {
      const newInterview = await this.reschedule(interview, dto);
      return { created: true as const, interview: newInterview };
    }

    const data: { status?: InterviewStatus; feedback?: string; scheduledAt?: Date } = {};
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.feedback !== undefined) data.feedback = dto.feedback;
    if (dto.scheduledAt !== undefined) data.scheduledAt = new Date(dto.scheduledAt);

    const result = await this.prisma.interview.updateMany({ where: { id, status: InterviewStatus.SCHEDULED }, data });
    if (result.count === 0) {
      throw new ConflictException(errorBody(409, 'interview_ja_encerrada', 'Esta entrevista já está em um status final.'));
    }
    const updated = await this.prisma.interview.findUniqueOrThrow({ where: { id } });
    return { created: false as const, interview: updated };
  }

  // Contrato de RESCHEDULED (DeepSeek, Fase 2 §5): cria uma NOVA entrevista
  // em vez de editar a original in-place — preserva o histórico de
  // reagendamentos (decisão de negócio, não técnica). `previousInterviewId`
  // é `@unique` no schema: cada entrevista só pode ser reagendada uma vez
  // "pra frente" (reagendar de novo parte da NOVA, não da antiga).
  private async reschedule(interview: { id: number; applicationId: number; interviewerId: number | null; scheduledAt: Date; isRemote: boolean; location: string | null; meetingLink: string | null; durationMinutes: number | null }, dto: UpdateInterviewDto) {
    if (!dto.scheduledAt) {
      throw new BadRequestException(errorBody(400, 'scheduled_at_obrigatorio', 'scheduledAt é obrigatório para reagendar (status RESCHEDULED).'));
    }
    return this.prisma.$transaction(async (tx) => {
      const originalUpdate = await tx.interview.updateMany({ where: { id: interview.id, status: InterviewStatus.SCHEDULED }, data: { status: InterviewStatus.RESCHEDULED } });
      if (originalUpdate.count === 0) {
        throw new ConflictException(errorBody(409, 'interview_ja_encerrada', 'Esta entrevista já está em um status final.'));
      }
      return tx.interview.create({
        data: {
          applicationId: interview.applicationId,
          scheduledAt: new Date(dto.scheduledAt!),
          interviewerId: interview.interviewerId,
          isRemote: interview.isRemote,
          location: interview.location,
          meetingLink: interview.meetingLink,
          durationMinutes: interview.durationMinutes,
          previousInterviewId: interview.id,
        },
      });
    });
  }

  private async findScopedOrThrow(id: number, currentUser: AuthenticatedUser) {
    const interview = await this.prisma.interview.findUnique({ where: { id }, include: INTERVIEW_INCLUDE });
    if (!interview || (!isAdmin(currentUser) && interview.application.job.companyId !== currentUser.companyId)) {
      throw interviewNotFound();
    }
    return interview;
  }
}
