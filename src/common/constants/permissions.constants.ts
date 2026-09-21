/**
 * Fonte única do catálogo de permissões do RBAC dinâmico (CE-2,
 * CONDICOES-ENTRADA-FASE2.md). Usado tanto pelo seed (prisma/seed.ts)
 * quanto pelos decorators/guards de autorização — nunca duplicar esta
 * lista em outro lugar (lição da auditoria do refeitorio-api, §7.1 de
 * FASE-1-MODELAGEM.md: fórmula de negócio em dois lugares diverge em
 * silêncio).
 *
 * Catálogo e distribuição por papel definidos pelo DeepSeek em
 * PARECER-DEEPSEEK-FASE1.md §2. A soma de ADMIN foi corrigida aqui: o
 * parecer dizia "todas as 28" mas também listava 4 exceções (ações que só
 * fazem sentido para CANDIDATE) — a versão consistente é 28 - 4 = 24, não
 * 28.
 */

export const SYSTEM_ROLES = {
  CANDIDATE: 'CANDIDATE',
  RECRUITER: 'RECRUITER',
  ADMIN: 'ADMIN',
} as const;

export type SystemRoleName = (typeof SYSTEM_ROLES)[keyof typeof SYSTEM_ROLES];

export const PERMISSIONS = {
  COMPANY_CREATE: 'company:create',
  COMPANY_READ: 'company:read',
  COMPANY_UPDATE: 'company:update',
  COMPANY_DELETE: 'company:delete',

  JOB_CREATE: 'job:create',
  JOB_READ: 'job:read',
  JOB_READ_ANY: 'job:read:any',
  JOB_UPDATE: 'job:update',
  JOB_DELETE: 'job:delete',
  JOB_STATUS_UPDATE: 'job:status:update',

  APPLICATION_CREATE: 'application:create',
  APPLICATION_READ_OWN: 'application:read:own',
  APPLICATION_READ_JOB: 'application:read:job',
  APPLICATION_READ_ANY: 'application:read:any',
  APPLICATION_STATUS_UPDATE: 'application:status:update',
  APPLICATION_WITHDRAW_OWN: 'application:withdraw:own',

  CANDIDATE_PROFILE_READ: 'candidate-profile:read',
  CANDIDATE_PROFILE_UPDATE_OWN: 'candidate-profile:update:own',

  INTERVIEW_CREATE: 'interview:create',
  INTERVIEW_READ: 'interview:read',
  INTERVIEW_UPDATE: 'interview:update',

  DOCUMENT_UPLOAD_OWN: 'document:upload:own',
  DOCUMENT_READ_OWN: 'document:read:own',
  DOCUMENT_READ_APPLICATION: 'document:read:application',

  USER_READ: 'user:read',
  USER_MANAGE: 'user:manage',
  ROLE_MANAGE: 'role:manage',
  APIKEY_MANAGE: 'apikey:manage',
} as const;

export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

const CANDIDATE_ONLY_KEYS: PermissionKey[] = [
  PERMISSIONS.APPLICATION_CREATE,
  PERMISSIONS.APPLICATION_WITHDRAW_OWN,
  PERMISSIONS.CANDIDATE_PROFILE_UPDATE_OWN,
  PERMISSIONS.DOCUMENT_UPLOAD_OWN,
];

export const CANDIDATE_PERMISSIONS: PermissionKey[] = [
  PERMISSIONS.JOB_READ,
  PERMISSIONS.APPLICATION_CREATE,
  PERMISSIONS.APPLICATION_READ_OWN,
  PERMISSIONS.APPLICATION_WITHDRAW_OWN,
  PERMISSIONS.CANDIDATE_PROFILE_READ,
  PERMISSIONS.CANDIDATE_PROFILE_UPDATE_OWN,
  PERMISSIONS.DOCUMENT_UPLOAD_OWN,
  PERMISSIONS.DOCUMENT_READ_OWN,
];

export const RECRUITER_PERMISSIONS: PermissionKey[] = [
  PERMISSIONS.COMPANY_READ,
  PERMISSIONS.JOB_CREATE,
  PERMISSIONS.JOB_READ,
  PERMISSIONS.JOB_READ_ANY,
  PERMISSIONS.JOB_UPDATE,
  PERMISSIONS.JOB_STATUS_UPDATE,
  PERMISSIONS.APPLICATION_READ_JOB,
  PERMISSIONS.APPLICATION_STATUS_UPDATE,
  PERMISSIONS.CANDIDATE_PROFILE_READ,
  PERMISSIONS.INTERVIEW_CREATE,
  PERMISSIONS.INTERVIEW_READ,
  PERMISSIONS.INTERVIEW_UPDATE,
  PERMISSIONS.DOCUMENT_READ_APPLICATION,
];

// ADMIN = todo o catálogo, exceto as ações exclusivas de candidato (papel
// puramente operacional/gestão — decisão da Fase 1, pergunta 1 do DeepSeek).
export const ADMIN_PERMISSIONS: PermissionKey[] = Object.values(PERMISSIONS).filter(
  (key) => !CANDIDATE_ONLY_KEYS.includes(key),
);

export const ROLE_PERMISSIONS: Record<SystemRoleName, PermissionKey[]> = {
  [SYSTEM_ROLES.CANDIDATE]: CANDIDATE_PERMISSIONS,
  [SYSTEM_ROLES.RECRUITER]: RECRUITER_PERMISSIONS,
  [SYSTEM_ROLES.ADMIN]: ADMIN_PERMISSIONS,
};
