import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CepService, isResolvedAddress } from '../common/cep/cep.service.js';
import { errorBody } from '../common/exceptions/error-body.util.js';
import { SYSTEM_ROLES } from '../common/constants/permissions.constants.js';
import { ApplicationStatus, Prisma } from '../generated/prisma/client.js';
import type { AuthenticatedUser } from '../common/types/authenticated-user.js';
import { UpdateCandidateProfileDto } from './dto/update-candidate-profile.dto.js';

function profileNotFound() {
  return new NotFoundException(errorBody(404, 'candidate_profile_not_found', 'Perfil de candidato não encontrado.'));
}

function isAdmin(user: AuthenticatedUser): boolean {
  return user.roleName === SYSTEM_ROLES.ADMIN;
}

// Achado crítico Qwen rodada 10 (C2): o predicado anterior era
// `status !== PENDING` — uma NEGAÇÃO que incluía qualquer status que
// ninguém tivesse pensado em excluir. `REJECTED` e `WITHDRAWN` caíam
// nela e destravavam o perfil completo, mesmo não sendo "progresso" (são
// ENCERRAMENTO). O caso mais grave: o candidato desistir da candidatura
// (`WITHDRAWN`) tinha como efeito colateral aumentar a exposição dos
// próprios dados — o oposto do que deveria acontecer. Lista POSITIVA
// agora: só os status que representam avanço real de avaliação destravam
// o completo.
const STATUSES_THAT_UNLOCK_FULL_PROFILE: ApplicationStatus[] = [
  ApplicationStatus.UNDER_REVIEW,
  ApplicationStatus.INTERVIEW,
  ApplicationStatus.OFFERED,
  ApplicationStatus.HIRED,
];

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
    // Achado Qwen rodada 10 (ressalva 1): só sobrescreve o endereço se a
    // consulta realmente resolveu algo — uma falha transitória do ViaCEP
    // não pode apagar um endereço bom só porque o candidato queria trocar
    // o telefone (nem mandou CEP diferente do que já tinha).
    const resolvedAddress = address && isResolvedAddress(address) ? address : undefined;

    const updateData: Prisma.CandidateProfileUpdateInput = {
      headline: dto.headline,
      summary: dto.summary,
      phone: dto.phone,
      cep: dto.cep,
      skills: dto.skills,
      ...(resolvedAddress ? { street: resolvedAddress.street, city: resolvedAddress.city, state: resolvedAddress.state } : {}),
    };

    try {
      const profile = await this.prisma.candidateProfile.upsert({
        where: { userId: currentUser.id },
        create: {
          userId: currentUser.id,
          headline: dto.headline,
          summary: dto.summary,
          phone: dto.phone,
          cep: dto.cep,
          street: address?.street ?? null,
          city: address?.city ?? null,
          state: address?.state ?? null,
          skills: dto.skills ?? [],
        },
        update: updateData,
        select: FULL_SELECT,
      });
      return toFullResponse(profile);
    } catch (error) {
      // Achado Qwen rodada 10 (P4): `upsert` não é atômico contra outra
      // requisição criando a MESMA linha entre a checagem interna do
      // Prisma e a escrita — duas chamadas concorrentes de
      // `PATCH /candidates/me` do mesmo usuário podiam produzir um `409`
      // "já existe um registro" para quem só estava editando o próprio
      // perfil (medido: 37,5% das requisições em 8 simultâneas). Sem
      // linha duplicada nem `5xx` (o `@@unique(userId)` protege a
      // integridade), mas a mensagem era enganosa. Em vez de propagar o
      // conflito, repete como `update` simples — a linha certamente
      // existe agora, pois foi exatamente isso que causou o `P2002`.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const profile = await this.prisma.candidateProfile.update({
          where: { userId: currentUser.id },
          data: updateData,
          select: FULL_SELECT,
        });
        return toFullResponse(profile);
      }
      throw error;
    }
  }

  async getByUserId(targetUserId: number, currentUser: AuthenticatedUser) {
    const target = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, roleId: true, role: { select: { name: true } } },
    });
    // Não revela se o `userId` existe mas não é candidato — mesmo 404 de
    // "perfil não encontrado" (política anti-enumeração já usada no
    // resto do projeto). Achado Qwen rodada 10 (ressalva 3): um perfil de
    // usuário DESATIVADO continua legível por quem já tem relação
    // (dono/ADMIN/recrutador com candidatura) — decisão consciente, não
    // omissão: histórico de processos em andamento não deve desaparecer
    // só porque o candidato desativou a própria conta. Só o LOGIN dele é
    // bloqueado (`findAuthenticatedById`), não a visibilidade do perfil.
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

    if (currentUser.id === targetUserId || isAdmin(currentUser)) {
      return toFullResponse(profile);
    }

    // Achado crítico Qwen rodada 10 (C1): faltava esta checagem. Sem ela,
    // um RECRUITER de empresa DESATIVADA continuava lendo telefone,
    // resumo e endereço de candidato — a metade de LEITURA do C3 da
    // rodada 8 (que só corrigiu a metade de ESCRITA em Jobs). O acesso
    // deriva de `Application` histórica, que nunca é apagada — sem esta
    // checagem, o efeito era permanente.
    if (currentUser.companyId === null) {
      throw profileNotFound();
    }
    const company = await this.prisma.company.findUnique({ where: { id: currentUser.companyId }, select: { isActive: true } });
    if (!company || !company.isActive) {
      throw profileNotFound();
    }

    // RECRUITER: só enxerga se existir alguma candidatura deste
    // candidato pra uma vaga da própria empresa — e só COMPLETO se
    // alguma candidatura já alcançou um status de avaliação de verdade
    // (ver `STATUSES_THAT_UNLOCK_FULL_PROFILE`, achado C2 acima).
    // Consulta a tabela `Application` direto — o módulo ainda não tem
    // controller próprio, mas o schema (Fase 1) já modela a relação.
    const applications = await this.prisma.application.findMany({
      where: { candidateId: targetUserId, job: { companyId: currentUser.companyId } },
      select: { status: true },
    });
    if (applications.length === 0) {
      throw profileNotFound();
    }
    const hasUnlockingApplication = applications.some((a) => STATUSES_THAT_UNLOCK_FULL_PROFILE.includes(a.status));
    return hasUnlockingApplication ? toFullResponse(profile) : toReducedResponse(profile);
  }
}
