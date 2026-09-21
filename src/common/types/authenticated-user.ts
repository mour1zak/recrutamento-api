import type { PermissionKey, SystemRoleName } from '../constants/permissions.constants.js';

/**
 * Formato de `request.user` depois do JwtStrategy — recalculado do banco a
 * cada request (nunca embutido no payload do JWT), para que uma mudança de
 * permissão em runtime (Nível B) tenha efeito imediato, sem depender de
 * cache/versão de token.
 */
export interface AuthenticatedUser {
  id: number;
  email: string;
  name: string;
  roleId: number;
  roleName: SystemRoleName | string;
  companyId: number | null;
  permissions: PermissionKey[];
}
