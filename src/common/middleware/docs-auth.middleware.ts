import type { NextFunction, Request, Response } from 'express';
import type { ConfigService } from '@nestjs/config';
import { timingSafeApiKeyMatch } from '../utils/api-key.util.js';

/**
 * Protege `/docs`, `/docs/*` e `/docs-json` com a mesma `x-api-key`
 * exigida no resto da API. Achado CRÍTICO Qwen rodada 15: o
 * `SwaggerModule.setup()` monta a UI/spec como middleware Express puro,
 * fora do pipeline de guards do Nest — `@UseGuards()`/`ApiKeyGuard` nunca
 * chegam a rodar aqui, então a documentação inteira (41 rotas, 17
 * schemas, as 24 permission keys por rota, os 15 `reason` codes) ficava
 * legível por qualquer um, sem nenhuma credencial. A decisão anterior
 * (documentação pública, "prática comum de mercado") não se sustenta
 * pra esta API: a própria CE-1 e o texto do `info.description` afirmam
 * "x-api-key obrigatória em toda rota, sem exceção" — deixar `/docs` de
 * fora era a API contradizendo o próprio contrato que publica.
 *
 * Replica exatamente o formato de erro que `ApiKeyGuard` produz via
 * `GlobalExceptionFilter` (401 + `WWW-Authenticate: Bearer`) — de
 * propósito, pra não criar um segundo formato de erro no projeto (a
 * mesma lição da unificação da rodada 6).
 */
export function createDocsAuthMiddleware(configService: ConfigService) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const providedKey = req.headers['x-api-key'];
    const expectedKey = configService.get<string>('API_KEY');

    if (!expectedKey || typeof providedKey !== 'string' || !timingSafeApiKeyMatch(providedKey, expectedKey)) {
      res.setHeader('WWW-Authenticate', 'Bearer');
      res.status(401).json({ statusCode: 401, error: 'Unauthorized', message: 'API key ausente ou inválida.' });
      return;
    }
    next();
  };
}
