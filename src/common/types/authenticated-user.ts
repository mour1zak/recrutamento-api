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
  // `string & {}` (não `string` puro): achado Qwen rodada 5 (N12) — um
  // union `SystemRoleName | string` é "overridden by string" (o linter
  // reclamou com razão: `roleName === 'ADMI'` continuava compilando,
  // porque `string` sozinho já aceita qualquer coisa). A intenção aqui é
  // legítima — RBAC dinâmico permite papéis criados em runtime além dos 3
  // do enunciado — só que sem apagar o autocomplete/checagem dos 3 nomes
  // conhecidos. `string & {}` é o truque de tipo que preserva os literais
  // de `SystemRoleName` como sugestão, sem intersectar para `never`.
  roleName: SystemRoleName | (string & {});
  companyId: number | null;
  permissions: PermissionKey[];
}
