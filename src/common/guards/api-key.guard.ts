import { createHash, timingSafeEqual } from 'node:crypto';
import { Injectable, UnauthorizedException, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Guard global (registrado como APP_GUARD) — camada de "cliente conhecido",
 * separada de "quem é o usuário" (isso é o JwtAuthGuard). Decisão CE-1:
 * o consumidor desta API é sempre um cliente
 * confiável (Postman/Swagger/curl), não um navegador — por isso a chave é
 * exigida globalmente, sem lista de rotas isentas, inclusive em
 * /auth/login (é defesa em camadas com um shared secret, não "Zero Trust").
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const providedKey = request.headers['x-api-key'];
    const expectedKey = this.configService.get<string>('API_KEY');

    if (!expectedKey) {
      // Configuração ausente é erro de ambiente, não de cliente — falha
      // fechado mesmo assim, mas não é o mesmo caso de "chave errada".
      throw new UnauthorizedException('API key não configurada no servidor.');
    }

    if (typeof providedKey !== 'string' || !this.matches(providedKey, expectedKey)) {
      throw new UnauthorizedException('API key ausente ou inválida.');
    }

    return true;
  }

  // Comparação em tempo constante (achado da auditoria técnica: comparação
  // ingênua com === vaza timing information sobre onde a string diverge).
  // Hash de tamanho fixo antes de comparar evita lidar com strings de
  // tamanhos diferentes, que o timingSafeEqual não aceita diretamente.
  private matches(provided: string, expected: string): boolean {
    const providedHash = createHash('sha256').update(provided).digest();
    const expectedHash = createHash('sha256').update(expected).digest();
    return timingSafeEqual(providedHash, expectedHash);
  }
}
