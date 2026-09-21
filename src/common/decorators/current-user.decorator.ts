import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AuthenticatedUser } from '../types/authenticated-user.js';

/**
 * Extrai o usuário autenticado de `request.user` (preenchido pelo
 * JwtStrategy). Nunca confiar em ID vindo do body/params para operações
 * pessoais — sempre usar este decorator (regra obrigatória do enunciado).
 */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
  const request = ctx.switchToHttp().getRequest();
  return request.user;
});
