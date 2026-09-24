# Triagem das revisões — Qwen rodada 15 (Swagger — REPROVADO → corrigido)

Resposta a `PARECER-QWEN-SWAGGER-RODADA15.md`. Mesma legenda: ✅ aceito e
corrigido · 📋 aceito, planejado pra fase futura · ⏸️ registrado, sem ação
agora.

## Bloqueante — corrigido nesta rodada

| Item | Correção | Como validamos |
|---|---|---|
| C1 — `LoginDto.example` publicava credencial real do ADMIN do seed | `email` trocado pra `usuario@example.com`, `password` pra `SenhaForte@123` (mesmo padrão já usado em `RegisterDto`) — [`src/auth/dto/login.dto.ts`](../../src/auth/dto/login.dto.ts). Grep em `src/` confirmou que nenhum outro DTO tinha o mesmo problema (`admin@recrutamento.test`, `recrutador@recrutamento.test`, `candidato@recrutamento.test`, `Senha@123` — zero ocorrências fora do comentário que documenta a correção) | Teste e2e novo (`test/docs.e2e-spec.ts`) assertando que `GET /docs-json` autenticado **nunca** contém nenhum dos 4 valores reais — trava de regressão, não só correção pontual |

## Decisão pedida — aceita: `/docs`/`/docs-json` atrás de `x-api-key`

| Item | Correção | Como validamos |
|---|---|---|
| `/docs`, `/docs/`, `/docs-json` sem credencial | `src/common/utils/api-key.util.ts` (novo): `timingSafeApiKeyMatch()` extraído de `ApiKeyGuard` — mesmo algoritmo, agora com dois consumidores, um lugar só. `src/common/middleware/docs-auth.middleware.ts` (novo): middleware Express que compara a `x-api-key` com a mesma função, e no erro devolve exatamente `{statusCode:401, error:'Unauthorized', message:'API key ausente ou inválida.'}` + header `WWW-Authenticate: Bearer` — o mesmo formato que `GlobalExceptionFilter` já produz pro `ApiKeyGuard`, sem criar um segundo formato de erro. `src/common/swagger.config.ts` (novo, extraído de `main.ts`): registra o middleware em `/docs` e `/docs-json` ANTES de `SwaggerModule.setup()`. `main.ts` só chama `configureSwagger(app)` agora | `test/docs.e2e-spec.ts`, 6 testes: sem key → 401 em `/docs`, `/docs/` (barra final) e `/docs-json`; key errada → 401; key certa → 200 nos dois; mais a trava de regressão da credencial (acima) |
| `ApiKeyGuard` duplicava o algoritmo de comparação | Refatorado pra usar `timingSafeApiKeyMatch()` do util novo, em vez de um método privado próprio — mesmo racional de `isCompanyOperable()`: um algoritmo sensível a timing com dois lugares diferentes é risco de divergência silenciosa | `npm test` (unitários de guards não quebraram) + `npm run test:e2e` completo |
| `info.description` se autocontradizia | Texto do `x-api-key` em `swagger.config.ts` atualizado: "obrigatória em toda rota, sem exceção" agora é verdade, incluindo `/docs` | Leitura do documento publicado |

## Antes de fechar o bônus — corrigido nesta rodada

| Item | Correção | Como validamos |
|---|---|---|
| Vazamento de mecanismo em `PUT /roles/:id/permissions` | Removida a palavra "`Serializable`" da descrição — mantido "atomicamente" e a regra de bloqueio, sem nomear o nível de isolamento | Leitura do documento |
| 0 de 175 respostas com `schema` (ressalva mais valiosa) | Adicionado `schema` a: `GET /users` (envelope paginado), `GET /jobs`/`GET /jobs/mine`/`GET /jobs/:id` (schema público × escopado, espelhando `PUBLIC_JOB_SELECT`/`SCOPED_JOB_INCLUDE`), `GET /candidates/me`/`PATCH /candidates/me` (completo) e `GET /candidates/:userId` (`oneOf` completo/reduzido, com a regra de negócio na descrição), `GET /applications/me`/`GET /jobs/:jobId/applications` (envelope com item completo) e `GET /applications/:id` (`oneOf` completo/reduzido). Schemas inline (`@ApiResponse({schema:{...}})`), não classes de modelo — mais rápido de manter em sincronia com os `select`/`include` reais dos services, ao custo de não aparecerem na seção "Schemas" do Swagger UI (ficam inline em cada operação) | Build limpo + leitura cruzada contra `jobs.service.ts`/`candidate-profile.service.ts`/`applications.service.ts` pra confirmar que cada schema espelha o `select`/`include`/função de resposta real, campo a campo |
| README "9 tags" | Corrigido pra "10 tags" — contagem real: Saúde, Autenticação, Usuários, Empresas, Vagas, Perfil de Candidato, Candidaturas, Entrevistas, Documentos, Papéis (RBAC) | Contagem manual das `@ApiTags` no código |
| README §2.2 desatualizado sobre a decisão de `/docs` público | Reescrito pra refletir a proteção nova e citar a Rodada 15 | Leitura do README após a edição |

## Desejável — registrado, sem ação agora

Ressalva 4 (sem `cache-control` em `/docs`/`/docs-json`) e ressalva 5
(descrição de escopo do `PACOTE-QWEN-SWAGGER.md` não citou a mudança no
pool do `pg`, mesmo sendo bem-vinda) — registradas em
`FEEDBACKS-MELHORIA.md`. A primeira perde relevância agora que `/docs`
exige credencial; a segunda é uma lição de processo (descrever o escopo
de um pacote com precisão), não algo que se corrija em código.

## Lição de processo registrada

É a segunda vez que uma decisão de arquitetura ("`/docs` pode ficar
público, é prática de mercado") não considerou que ESTA API já tinha
decidido o oposto três vezes (CE-1) — o próprio texto publicado se
contradizia. Regra pra qualquer decisão de exposição futura: antes de
justificar por "prática comum de mercado", conferir se o projeto já tem
uma decisão registrada que a prática comum contradiria.

## Verificação

Build limpo · lint 0 avisos (91 arquivos) · `npm test` **9/9** ·
`npm run test:e2e` **158/158** (152 anteriores + 6 novos de
`docs.e2e-spec.ts`) · nenhuma rota de negócio já auditada mudou de
comportamento — só o middleware novo em `/docs`/`/docs-json`, a extração
de `timingSafeApiKeyMatch()` (mesmo algoritmo, sem mudança de
comportamento) e os `example`/`schema` do Swagger.
