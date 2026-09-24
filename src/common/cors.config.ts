import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Extraído de `main.ts` pelo mesmo motivo de `configureSwagger`
 * (`swagger.config.ts`): testes e2e criam a aplicação direto do
 * `AppModule`, sem passar por `bootstrap()` — precisam de uma função
 * própria pra registrar exatamente a mesma configuração que a aplicação
 * real usa, sem importar `main.ts` (que dispara `app.listen()` só de ser
 * importado).
 *
 * Sem CORS, qualquer frontend rodando no navegador (porta diferente da
 * API) é bloqueado pelo same-origin policy antes de a requisição chegar
 * na API. `CORS_ORIGIN` (lista separada por vírgula) restringe a origens
 * específicas; sem a variável, aceita qualquer uma — a API key + JWT
 * continuam obrigatórios em toda rota de negócio, CORS não é a camada de
 * autorização deste projeto.
 */
export function configureCors(app: INestApplication): void {
  const configService = app.get(ConfigService);
  const corsOrigin = configService.get<string>('CORS_ORIGIN');
  app.enableCors({
    origin: corsOrigin ? corsOrigin.split(',').map((o) => o.trim()) : true,
    credentials: true,
  });
}
