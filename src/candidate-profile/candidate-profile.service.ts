import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CepService } from '../common/cep/cep.service.js';
import { errorBody } from '../common/exceptions/error-body.util.js';
import { SYSTEM_ROLES } from '../common/constants/permissions.constants.js';
import { ApplicationStatus } from '../generated/prisma/client.js';
import type { AuthenticatedUser } from '../common/types/authenticated-user.js';
import { UpdateCandidateProfileDto } from './dto/update-candidate-profile.dto.js';

function profileNotFound() {
  return new NotFoundException(errorBody(404, 'candidate_profile_not_found', 'Perfil de candidato não encontrado.'));
}

const FULL_SELECT = {
  headline: true,
  summary: true,
  phone: true,
  cep: true,
  street: true,
  city: true,
  state: true,
  skills: true,
  user: { select: { id: true, name: true } },
} as const;

function toFullResponse(profile: {
  user: { id: number; name: string };
  headline: string | null;
  summary: string | null;
  phone: string | null;
  cep: string | null;
  street: string | null;
  city: string | null;
  state: string | null;
  skills: string[];
}) {
  return {
    id: profile.user.id,
    name: profile.user.name,
    headline: profile.headline,
    summary: profile.summary,
    phone: profile.phone,
    cep: profile.cep,
    street: profile.street,
    city: profile.city,
    state: profile.state,
    skills: profile.skills,
  };
}

function toReducedResponse(profile: { user: { id: number; name: string }; headline: string | null; skills: string[] }) {
  // Payload condicional (Fase 1, Pergunta 2 do DeepSeek): antes de a
  // candidatura avançar de PENDING, o recrutador só vê o mínimo pra
  // triagem inicial — nada de telefone/resumo/endereço.
  return { id: profile.user.id, name: profile.user.name, headline: profile.headline, skills: profile.skills };
}

@Injectable()
export class CandidateProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cepService: CepService,
  ) {}

  async getMine(currentUser: AuthenticatedUser) {
    const profile = await this.prisma.candidateProfile.findUnique({
      where: { userId: currentUser.id },
      select: FULL_SELECT,
    });
    if (!profile) {
      throw profileNotFound();
    }
    return toFullResponse(profile);
  }

  async upsertMine(currentUser: AuthenticatedUser, dto: UpdateCandidateProfileDto) {
    const address = dto.cep ? await this.cepService.resolve(dto.cep) : undefined;

    const profile = await this.prisma.candidateProfile.upsert({
      where: { userId: currentUser.id },
      create: {
        userId: currentUser.id,
        headline: dto.headline,
        summary: dto.summary,
        phone: dto.phone,
        cep: dto.cep,
        street: address?.street,
        city: address?.city,
        state: address?.state,
        skills: dto.skills ?? [],
      },
      update: {
        headline: dto.headline,
        summary: dto.summary,
        phone: dto.phone,
        cep: dto.cep,
        street: address?.street,
        city: address?.city,
        state: address?.state,
        skills: dto.skills,
      },
      select: FULL_SELECT,
    });
    return toFullResponse(profile);
  }

  async getByUserId(targetUserId: number, currentUser: AuthenticatedUser) {
    const target = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, roleId: true, role: { select: { name: true } } },
    });
    // Não revela se o `userId` existe mas não é candidato — mesmo 404 de
    // "perfil não encontrado" (política anti-enumeração já usada no
    // resto do projeto).
    if (!target || target.role.name !== SYSTEM_ROLES.CANDIDATE) {
      throw profileNotFound();
    }

    const profile = await this.prisma.candidateProfile.findUnique({
      where: { userId: targetUserId },
      select: FULL_SELECT,
    });
    if (!profile) {
      throw profileNotFound();
    }

    if (currentUser.id === targetUserId || currentUser.roleName === SYSTEM_ROLES.ADMIN) {
      return toFullResponse(profile);
    }

    // RECRUITER: só enxerga se existir alguma candidatura deste
    // candidato pra uma vaga da própria empresa — e só COMPLETO se
    // alguma dessas candidaturas já passou de PENDING (a empresa já
    // tomou alguma ação sobre ela). Consulta a tabela `Application`
    // direto — o módulo ainda não tem controller próprio, mas o schema
    // (Fase 1) já modela a relação.
    if (currentUser.companyId === null) {
      throw profileNotFound();
    }
    const applications = await this.prisma.application.findMany({
      where: { candidateId: targetUserId, job: { companyId: currentUser.companyId } },
      select: { status: true },
    });
    if (applications.length === 0) {
      throw profileNotFound();
    }
    const hasProgressedPastPending = applications.some((a) => a.status !== ApplicationStatus.PENDING);
    return hasProgressedPastPending ? toFullResponse(profile) : toReducedResponse(profile);
  }
}
