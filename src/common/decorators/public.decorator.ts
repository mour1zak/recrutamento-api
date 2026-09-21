import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Isenta uma rota do JwtAuthGuard global (login, register, refresh). Não
 * isenta do ApiKeyGuard — a decisão CE-1 continua valendo, isso só marca
 * "não precisa estar logado", não "não precisa de API key".
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
