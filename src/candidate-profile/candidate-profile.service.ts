import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CEP_UNAVAILABLE_WARNING, CepService } from '../common/cep/cep.service.js';
import { errorBody } from '../common/exceptions/error-body.util.js';
import { SYSTEM_ROLES } from '../common/constants/permissions.constants.js';
import { isAdmin } from '../common/utils/role.util.js';
import { isCompanyOperable } from '../common/utils/company-scope.util.js';
import { ApplicationStatus, Prisma } from '../generated/prisma/client.js';
import type { AuthenticatedUser } from '../common/types/authenticated-user.js';
import { UpdateCandidateProfileDto } from './dto/update-candidate-profile.dto.js';

function profileNotFound() {
  return new NotFoundException(errorBody(404, 'candidate_profile_not_found', 'Perfil de candidato não encontrado.'));
}

function cepInvalidError() {
  return new BadRequestException(errorBody(400, 'cep_nao_encontrado', 'CEP informado não existe.'));
}

// Achado crítico da revisão técnica (C2): o predicado anterior era
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
  // Payload condicional (Fase 1, Pergunta 2 da especificação de negócio): antes de a
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
    // Achado da revisão técnica (N1): a correção anterior ("preserva
    // endereço se a consulta não resolveu nada") tratava CEP inválido e
    // falha de rede da mesma forma — permitindo salvar um `cep` novo com o
    // `street/city/state` do endereço ANTIGO, um par inconsistente. Agora
    // só "unavailable" preserva; "invalid" rejeita a atualização inteira
    // (mesmo contrato de CompaniesService).
    const resolution = dto.cep ? await this.cepService.resolve(dto.cep) : undefined;
    if (resolution?.status === 'invalid') {
      throw cepInvalidError();
    }

    const updateData: Prisma.CandidateProfileUpdateInput = {
      headline: dto.headline,
      summary: dto.summary,
      phone: dto.phone,
      cep: dto.cep,
      skills: dto.skills,
      ...(resolution?.status === 'ok' ? { street: resolution.street, city: resolution.city, state: resolution.state } : {}),
    };
    const addressWarning = resolution?.status === 'unavailable' ? CEP_UNAVAILABLE_WARNING : undefined;

    try {
      const profile = await this.prisma.candidateProfile.upsert({
        where: { userId: currentUser.id },
        create: {
          userId: currentUser.id,
          headline: dto.headline,
          summary: dto.summary,
          phone: dto.phone,
          cep: dto.cep,
          street: resolution?.status === 'ok' ? resolution.street : null,
          city: resolution?.status === 'ok' ? resolution.city : null,
          state: resolution?.status === 'ok' ? resolution.state : null,
          skills: dto.skills ?? [],
        },
        update: updateData,
        select: FULL_SELECT,
      });
      const response = toFullResponse(profile);
      return addressWarning ? { ...response, addressWarning } : response;
    } catch (error) {
      // Achado da revisão técnica (P4): `upsert` não é atômico contra outra
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
        const response = toFullResponse(profile);
        return addressWarning ? { ...response, addressWarning } : response;
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
    // resto do projeto). Achado da revisão técnica (ressalva 3): um perfil de
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

    // Achado crítico da revisão técnica (C1): faltava esta checagem. Sem ela,
    // um RECRUITER de empresa DESATIVADA continuava lendo telefone,
    // resumo e endereço de candidato — a metade de LEITURA do C3
    // (que só corrigiu a metade de ESCRITA em Jobs). O acesso
    // deriva de `Application` histórica, que nunca é apagada — sem esta
    // checagem, o efeito era permanente.
    // Achado da revisão técnica: o predicado (não o lançamento do erro) agora
    // é compartilhado com `JobsService` via `isCompanyOperable()` —
    // `Application` (que ganhou módulo próprio nesta rodada) é o terceiro
    // consumidor da mesma pergunta. A checagem `=== null` explícita
    // continua aqui (redundante com a de dentro de `isCompanyOperable`)
    // só para o TypeScript estreitar o tipo pro `where` abaixo — uma
    // chamada de função não propaga esse estreitamento sozinha.
    const companyId = currentUser.companyId;
    if (companyId === null || !(await isCompanyOperable(this.prisma, companyId))) {
      throw profileNotFound();
    }

    // RECRUITER: só enxerga se existir alguma candidatura deste
    // candidato pra uma vaga da própria empresa — e só COMPLETO se
    // alguma candidatura já alcançou um status de avaliação de verdade
    // (ver `STATUSES_THAT_UNLOCK_FULL_PROFILE`, achado C2 acima).
    const applications = await this.prisma.application.findMany({
      where: { candidateId: targetUserId, job: { companyId } },
      select: { status: true },
    });
    if (applications.length === 0) {
      throw profileNotFound();
    }
    const hasUnlockingApplication = applications.some((a) => STATUSES_THAT_UNLOCK_FULL_PROFILE.includes(a.status));
    return hasUnlockingApplication ? toFullResponse(profile) : toReducedResponse(profile);
  }
}
