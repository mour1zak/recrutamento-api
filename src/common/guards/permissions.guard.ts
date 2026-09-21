import { Injectable, ForbiddenException, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator.js';
import type { PermissionKey } from '../constants/permissions.constants.js';
import type { AuthenticatedUser } from '../types/authenticated-user.js';

/**
 * Precisa de `request.user` já preenchido pelo JwtAuthGuard. Isso só é
 * garantido porque os dois são registrados como APP_GUARD globais em
 * app.module.ts, NESTA ordem: [ApiKeyGuard, JwtAuthGuard,
 * PermissionsGuard] — guards globais rodam antes de qualquer guard de
 * controller/rota, na ordem em que aparecem no array de providers.
 * CORREÇÃO (achado crítico Qwen rodada 4, C2): a versão anterior deste
 * comentário afirmava esse comportamento sem que ele existisse de fato —
 * o JwtAuthGuard só era aplicado por controller (@UseGuards), então rodava
 * DEPOIS deste guard global, e toda rota com @Permissions() retornava 403
 * mesmo para quem tinha a permissão. Nunca mude a ordem deste array sem
 * revalidar isso com um teste e2e.
 *
 * Só decide "o papel tem esta permission key" — 403 quando falta. Recurso
 * de terceiro (permissão existe, mas o recurso não é do usuário) é 404,
 * decidido no Service, não aqui (política registrada em
 * FASE-1-MODELAGEM.md §5.1).
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<PermissionKey[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!required || required.length === 0) {
      return true;
    }

    const user: AuthenticatedUser | undefined = context.switchToHttp().getRequest().user;

    if (!user || !required.every((permission) => user.permissions.includes(permission))) {
      throw new ForbiddenException('Você não tem permissão para executar esta ação.');
    }

    return true;
  }
}
