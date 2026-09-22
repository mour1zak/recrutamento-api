import { Controller, Param, ParseIntPipe, Patch } from '@nestjs/common';
import { UsersService } from './users.service.js';
import { Permissions } from '../common/decorators/permissions.decorator.js';
import { PERMISSIONS } from '../common/constants/permissions.constants.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../common/types/authenticated-user.js';

// Primeiro endpoint protegido por permission key do projeto — serve
// também de prova de que a correção do achado C2 (ordem dos guards,
// rodada 4) funciona: usuário com `user:manage` → 2xx; sem a permissão →
// 403 (ver test/users.e2e-spec.ts).
//
// deactivate/reactivate devolvem `200` + o usuário atualizado (decisão
// pós-Fase-2, pensando no frontend): sem isso, quem chama a rota não
// tinha como confirmar `isActive` sem um GET extra. Antes disso, as duas
// respondiam `204` sem corpo — mudança só de contrato de resposta, a
// lógica de negócio auditada (trava de último admin, revogação de
// refresh tokens) continua idêntica.
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Permissions(PERMISSIONS.USER_MANAGE)
  @Patch(':id/deactivate')
  deactivate(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthenticatedUser) {
    return this.usersService.deactivate(id, user.id);
  }

  // Achado Qwen rodada 6 (N1-c): sem esta rota, uma desativação errada
  // (ex.: ADMIN desativa o recrutador errado) era irreversível pela API.
  @Permissions(PERMISSIONS.USER_MANAGE)
  @Patch(':id/reactivate')
  reactivate(@Param('id', ParseIntPipe) id: number) {
    return this.usersService.reactivate(id);
  }
}
