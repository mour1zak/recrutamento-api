# Triagem das revisões — Qwen rodada 4 (Fase 2, Auth)

Resposta do time a `PARECER-QWEN-FASE2-AUTH-RODADA4.md`. Mesma legenda das
triagens anteriores: ✅ aceito e corrigido · 📋 aceito, planejado pra fase
futura · ⚖️ discordamos · 🟡 pendente de decisão.

**Nota:** esta foi a primeira rodada sobre código de aplicação (não
schema), e os 5 críticos foram todos reproduzidos por execução real — não
há nada aqui pra discordar tecnicamente. Todos aceitos e corrigidos.

## Falhas críticas

| ID | Item | Veredito | Correção |
|---|---|---|---|
| C1 | Bypass de autenticação com segredo placeholder | ✅ | `src/config/env.validation.ts` (Joi) — app recusa subir se `JWT_SECRET`/`API_KEY` forem os valores do `.env.example`, ou iguais entre si. Provado: boot com o placeholder → crash no `ConfigModule.forRoot`, antes de qualquer rota existir. |
| C2 | `PermissionsGuard` rodava antes do `JwtAuthGuard` | ✅ | `JwtAuthGuard` virou global (`APP_GUARD`), com `@Public()` isentando `auth/register\|login\|refresh`. Ordem corrigida: `[ApiKeyGuard, JwtAuthGuard, PermissionsGuard]`. Comentário do `PermissionsGuard` reescrito. Provado com rota real (`PATCH /users/:id/deactivate`, `user:manage`): candidato → `403`; admin → passa da checagem (404 do Service pro ID inexistente, não 403 do Guard). |
| C3 | Suíte e2e vermelha, README mentindo | ✅ | `test/app.e2e-spec.ts` atualizado (`/health` + `x-api-key`); `test/auth.e2e-spec.ts` novo, cobrindo os 5 cenários pedidos + o teste de permissão do C2. `.env.test` passou a ser **versionado** (exceção deliberada no `.gitignore`) com segredos dedicados só de teste, pra funcionar em clone novo sem configuração manual. `npm test` + `npm run test:e2e`: **12 testes, todos verdes**, confirmados isolados e em conjunto. |
| C4 | Rotação de refresh não atômica | ✅ | `updateMany({ where: { id, revokedAt: null } })` checando `count === 1` — a mesma correção que a lição da concorrência já pedia para `filledCount`, aplicada aqui. Provado: 10 requisições simultâneas com o mesmo token → exatamente 1 sucesso, 9 `401`. |
| C5 | `deactivate()` sem chamador | ✅ | `UsersController` novo, `PATCH /users/:id/deactivate` protegido por `user:manage` — serve também de prova para o C2. Provado: desativa de verdade (`isActive=false`, refresh tokens revogados), e login do usuário desativado → `401`. |

## Ressalvas exigidas para reapresentação

| ID | Item | Veredito | Correção |
|---|---|---|---|
| R1 | Sem filtro global — erro do Prisma virava 500 | ✅ | `PrismaExceptionFilter` (`APP_FILTER`) mapeia `P2002`→409, `P2025`→404, `P2003`→400, `P2034`/`P2028`→409. Provado: 5 registros simultâneos com o mesmo email → 1×`201`, 4×`409`, zero `500`. |
| R4 | Seed com credencial hardcoded/logada | ✅ | Senha vem de `SEED_USER_PASSWORD` (fallback documentado); nunca impressa em log; seed recusa rodar com `NODE_ENV=production`. |

## Ressalvas menores — destino

| ID | Item | Veredito | Detalhe |
|---|---|---|---|
| R2 | check-then-create em `createCandidate` | ✅ | Removida a checagem prévia; conta só com `@@unique(email)` + `PrismaExceptionFilter`. |
| R3 | Rate limiting ausente | 📋 | `FEEDBACKS-MELHORIA.md` já registra como pendência de decisão para a Fase 2/3 — não corrigido nesta rodada, mantido no radar. |
| R5 | `JWT_REFRESH_SECRET` morto | ✅ | Removido de `.env`/`.env.test`/`.env.example`. |
| R6 | `parseDurationToMs` sem validação (`"1w"` → 500) | ✅ | Coberto pela validação Joi (`DURATION_PATTERN`) — falha no boot, não no primeiro login. |
| R7 | Tipagem furada (`as never`) | ✅ (parcial) | `permissions.map(...)` agora usa `as PermissionKey` (com intenção clara) em vez de `as never`. O `expiresIn: ... as never` do JWT continua — é fricção de tipo da lib (`ms.StringValue`), não um buraco de segurança; mantido com comentário. |
| R8 | Build em clone fresco falha; falta `engines` | ✅ | `"prebuild": "prisma generate"` no `package.json` (roda sem precisar de banco vivo — testado com `src/generated/` apagado). `"engines": { "node": ">=22" }` adicionado. |
| R9 | `logout` não confere `count` | ⏸️ | Baixo impacto (a resposta já é uniforme, `204` sempre) — não corrigido nesta rodada, registrado como pendência menor. |
| R10 | API key sem rotação | ⚖️ (mantido) | Decisão CE-1 já documentada com a limitação explícita em `FEEDBACKS-MELHORIA.md` #6. |
| R11 | Seed deriva de `ROLE_PERMISSIONS`, não de `PERMISSIONS` | 📋 | Registrado em `FEEDBACKS-MELHORIA.md` (novo item) — risco real mas de baixa probabilidade hoje (catálogo pequeno, revisado). |
| R12 | `APIKEY_MANAGE` é permissão morta | ✅ | Comentário adicionado em `permissions.constants.ts` marcando como reserva para `FEEDBACKS-MELHORIA.md` #6. |
| R13 | Normalização de email só na aplicação | 📋 | Registrado como item do Gate Fase 3 (`CONDICOES-ENTRADA-FASE2.md`) — relevante quando SQL bruto começar a ser escrito. |
| R14 | Parecer do DeepSeek cita 49 grants | ✅ | Nota de correção adicionada no topo de `PARECER-DEEPSEEK-FASE1.md`, texto original preservado abaixo. |
| R15 | `GET /` "Hello World" atrás do guard | ✅ | Substituído por `GET /health` (`@Public()` do JWT, ainda exige API key). |

## Sugestões — destino

- **`crypto.scrypt` em vez de `bcryptjs`**: registrado como item novo em `FEEDBACKS-MELHORIA.md` — mudança estrutural maior (todos os hashes existentes precisariam de rehash preguiçoso), não feita nesta rodada.
- **Equalizar tempo de login (P4)**: ✅ feito agora — `DUMMY_PASSWORD_HASH` em `auth.service.ts`, `verifyPassword` sempre chamado, exista o usuário ou não.
- **Healthcheck isento de API key**: não aplicado — mantivemos `/health` exigindo API key também, para não abrir uma exceção à decisão CE-1 sem necessidade concreta ainda.
- **CI mínimo**: registrado em `FEEDBACKS-MELHORIA.md` — não implementado nesta rodada (não bloqueia Fase 2).
- **`familyId` em `RefreshToken`**: registrado em `FEEDBACKS-MELHORIA.md` como decisão explícita adiada (schema ainda pode mudar sem migration dolorosa, mas não implementado agora).
