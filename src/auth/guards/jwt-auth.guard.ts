import { Injectable, type ExecutionContext } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator.js';

/**
 * Global (registrado como APP_GUARD em app.module.ts) — corrige achado
 * crítico da auditoria técnica (C2): antes, este guard só era
 * aplicado por controller via @UseGuards(), mas o PermissionsGuard já era
 * global. Guards globais sempre rodam antes de guards de controller no
 * Nest, então o PermissionsGuard rodava com `request.user` ainda
 * `undefined` — toda rota com @Permissions() retornava 403, mesmo para
 * quem tinha a permissão. Tornando este guard também global, na ordem
 * correta (API key → JWT → permissão), o problema desaparece. Rotas que
 * não exigem login (auth/register, auth/login, auth/refresh) usam
 * @Public() para serem isentadas.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    return super.canActivate(context);
  }
}
