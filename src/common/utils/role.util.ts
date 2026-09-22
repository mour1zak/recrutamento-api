import { SYSTEM_ROLES } from '../constants/permissions.constants.js';
import type { AuthenticatedUser } from '../types/authenticated-user.js';

// Achado Qwen rodada 11 (ressalva 2): esta função de 3 linhas existia
// verbatim em `jobs.service.ts` e `candidate-profile.service.ts` — mesma
// lógica, sem variação de comportamento a preservar, então o custo de
// duplicar era zero benefício. Extraída aqui pra eliminar exatamente o
// padrão que o projeto já lista como lição (§7.1, fórmula de negócio em
// dois lugares divergindo em silêncio).
export function isAdmin(user: AuthenticatedUser): boolean {
  return user.roleName === SYSTEM_ROLES.ADMIN;
}
