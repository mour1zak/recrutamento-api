import { Injectable, UnauthorizedException, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeApiKeyMatch } from '../utils/api-key.util.js';

/**
 * Guard global (registrado como APP_GUARD) — camada de "cliente conhecido",
 * separada de "quem é o usuário" (isso é o JwtAuthGuard). Decisão CE-1
 * (CONDICOES-ENTRADA-FASE2.md): o consumidor desta API é sempre um cliente
 * confiável (Postman/Swagger/curl), não um navegador — por isso a chave é
 * exigida globalmente, sem lista de rotas isentas, inclusive em
 * /auth/login. Ver FASE-1-MODELAGEM.md §5.1 para a limitação documentada
 * (é defesa em camadas com um shared secret, não "Zero Trust").
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

    if (typeof providedKey !== 'string' || !timingSafeApiKeyMatch(providedKey, expectedKey)) {
      throw new UnauthorizedException('API key ausente ou inválida.');
    }

    return true;
  }
}
