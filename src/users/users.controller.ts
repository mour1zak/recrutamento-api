import { Controller, HttpCode, HttpStatus, Param, ParseIntPipe, Patch } from '@nestjs/common';
import { UsersService } from './users.service.js';
import { Permissions } from '../common/decorators/permissions.decorator.js';
import { PERMISSIONS } from '../common/constants/permissions.constants.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../common/types/authenticated-user.js';

// Primeiro endpoint protegido por permission key do projeto — serve
// também de prova de que a correção do achado C2 (ordem dos guards,
// rodada 4) funciona: usuário com `user:manage` → 2xx; sem a permissão →
// 403 (ver test/users.e2e-spec.ts).
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Permissions(PERMISSIONS.USER_MANAGE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @Patch(':id/deactivate')
  deactivate(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthenticatedUser) {
    return this.usersService.deactivate(id, user.id);
  }
}
