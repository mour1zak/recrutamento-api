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
 *
 * `credentials: true` só quando `CORS_ORIGIN` está definida (achado da
 * revisão técnica, defesa em profundidade): `credentials: true` + origem
 * refletida sem restrição é o padrão clássico que auditoria de CORS
 * assinala. Hoje é inexplorável (autenticação por header customizado, o
 * navegador nunca anexa isso sozinho — não há cookie envolvido), mas se
 * um dia o front guardar token em cookie, essa combinação vira vetor de
 * account takeover. Travar aqui custa 1 linha e elimina o risco antes de
 * ele existir de verdade.
 */
export function configureCors(app: INestApplication): void {
  const configService = app.get(ConfigService);
  const corsOrigin = configService.get<string>('CORS_ORIGIN');
  app.enableCors({
    origin: corsOrigin ? corsOrigin.split(',').map((o) => o.trim()) : true,
    credentials: Boolean(corsOrigin),
  });
}
