# Triagem das revisões — Qwen rodada 15 (Swagger — REPROVADO → corrigido)

Resposta a `PARECER-QWEN-SWAGGER-RODADA15.md`. Mesma legenda: ✅ aceito e
corrigido · 📋 aceito, planejado pra fase futura · ⏸️ registrado, sem ação
agora.

## Bloqueante — corrigido nesta rodada

| Item | Correção | Como validamos |
|---|---|---|
| C1 — `LoginDto.example` publicava credencial real do ADMIN do seed | `email` trocado pra `usuario@example.com`, `password` pra `SenhaForte@123` (mesmo padrão já usado em `RegisterDto`) — [`src/auth/dto/login.dto.ts`](../../src/auth/dto/login.dto.ts). Grep em `src/` confirmou que nenhum outro DTO tinha o mesmo problema (`admin@recrutamento.test`, `recrutador@recrutamento.test`, `candidato@recrutamento.test`, `Senha@123` — zero ocorrências fora do comentário que documenta a correção) | Teste e2e novo (`test/docs.e2e-spec.ts`) assertando que `GET /docs-json` autenticado **nunca** contém nenhum dos 4 valores reais — trava de regressão, não só correção pontual |

## Decisão pedida — implementada e depois REVERTIDA por decisão de produto

Aceitamos inicialmente a recomendação do Qwen: `src/common/utils/api-key.util.ts`
(`timingSafeApiKeyMatch()` extraído de `ApiKeyGuard`) +
`src/common/middleware/docs-auth.middleware.ts` (middleware Express
exigindo `x-api-key`, com fallback de `Authorization: Basic
<usuário>:<x-api-key>` especificamente pra acionar o popup nativo de
login do navegador, já que a barra de endereço não manda header
customizado) + `src/common/swagger.config.ts` registrando o middleware
antes de `SwaggerModule.setup()`. Chegou a passar por 8 testes e2e e foi
confirmado funcionando ao vivo (curl, Supertest, e navegação real com
credencial embutida na URL).

**Revertido a pedido da dona do produto**, depois de ver o resultado na
prática: o popup nativo de Basic Auth pede "usuário e senha" — campos que
não existem conceitualmente neste projeto, só existe UMA chave
compartilhada. Precisar explicar "digite qualquer coisa no usuário, a
`x-api-key` na senha" foi considerado uma fricção de UX pior do que o
risco residual que a Rodada 15 apontou, dado que a causa raiz de verdade
(a credencial real vazada no `example`) já estava corrigida
independentemente dessa decisão.

**Estado final:** `docs-auth.middleware.ts` e `api-key.util.ts` foram
removidos (arquivos sem uso viram código morto — `ApiKeyGuard` voltou a
ter seu próprio método privado de comparação, já que não há mais um
segundo consumidor). `/docs`/`/docs-json` estão públicos de novo, sem
nenhuma credencial exigida. `info.description` em `swagger.config.ts`
foi ajustado pra não afirmar mais "sem exceção" — agora diz
explicitamente que `x-api-key` é obrigatória em toda rota de NEGÓCIO,
com a própria documentação como exceção deliberada, exatamente como o
Qwen pediu pra registrar caso a decisão final fosse manter público.

| Item | Estado final | Como validamos |
|---|---|---|
| `/docs`, `/docs-json` sem credencial | Público de propósito (decisão revertida, ver acima) | `test/docs.e2e-spec.ts`: `GET /docs` e `GET /docs-json` sem nenhum header → `200` |
| Credencial real vazada no `example` (a causa raiz) | Continua corrigida, independente da decisão de exposição | Mesmo teste: `GET /docs-json` nunca contém `admin@recrutamento.test`/`recrutador@recrutamento.test`/`candidato@recrutamento.test`/`Senha@123` |
| `info.description` se autocontradizia | Corrigido pra descrever o estado real: obrigatória em toda rota de negócio, exceto a documentação | Leitura do documento publicado |

## Antes de fechar o bônus — corrigido nesta rodada

| Item | Correção | Como validamos |
|---|---|---|
| Vazamento de mecanismo em `PUT /roles/:id/permissions` | Removida a palavra "`Serializable`" da descrição — mantido "atomicamente" e a regra de bloqueio, sem nomear o nível de isolamento | Leitura do documento |
| 0 de 175 respostas com `schema` (ressalva mais valiosa) | Adicionado `schema` a: `GET /users` (envelope paginado), `GET /jobs`/`GET /jobs/mine`/`GET /jobs/:id` (schema público × escopado, espelhando `PUBLIC_JOB_SELECT`/`SCOPED_JOB_INCLUDE`), `GET /candidates/me`/`PATCH /candidates/me` (completo) e `GET /candidates/:userId` (`oneOf` completo/reduzido, com a regra de negócio na descrição), `GET /applications/me`/`GET /jobs/:jobId/applications` (envelope com item completo) e `GET /applications/:id` (`oneOf` completo/reduzido). Schemas inline (`@ApiResponse({schema:{...}})`), não classes de modelo — mais rápido de manter em sincronia com os `select`/`include` reais dos services, ao custo de não aparecerem na seção "Schemas" do Swagger UI (ficam inline em cada operação) | Build limpo + leitura cruzada contra `jobs.service.ts`/`candidate-profile.service.ts`/`applications.service.ts` pra confirmar que cada schema espelha o `select`/`include`/função de resposta real, campo a campo |
| README "9 tags" | Corrigido pra "10 tags" — contagem real: Saúde, Autenticação, Usuários, Empresas, Vagas, Perfil de Candidato, Candidaturas, Entrevistas, Documentos, Papéis (RBAC) | Contagem manual das `@ApiTags` no código |
| README §2.2 desatualizado sobre a decisão de `/docs` público | Reescrito pra refletir a proteção nova e citar a Rodada 15 | Leitura do README após a edição |

## Desejável — registrado, sem ação agora

Ressalva 4 (sem `cache-control` em `/docs`/`/docs-json`) volta a ser
relevante já que `/docs` é público de novo — registrada em
`FEEDBACKS-MELHORIA.md` como melhoria de baixo custo, não crítica (o
documento não tem dado de usuário, só o contrato da API). Ressalva 5
(descrição de escopo do `PACOTE-QWEN-SWAGGER.md` não citou a mudança no
pool do `pg`) é uma lição de processo, não algo que se corrija em código.

## Lição de processo registrada

Duas lições desta rodada, de naturezas diferentes:

1. A decisão original ("`/docs` pode ficar público, é prática de
   mercado") não considerou que ESTA API já tinha decidido o oposto três
   vezes (CE-1) — o próprio texto publicado se contradizia. Regra pra
   qualquer decisão de exposição futura: antes de justificar por "prática
   comum de mercado", conferir se o projeto já tem uma decisão registrada
   que a prática comum contradiria.
2. A correção "certa" tecnicamente (exigir `x-api-key`) foi implementada,
   testada e funcionou — e ainda assim foi revertida, porque o custo de
   UX real (navegador pedindo "usuário/senha" pra uma chave sem conceito
   de usuário) só ficou visível depois de ver o resultado funcionando de
   verdade, não na hora de decidir no papel. Lição: pra decisões de UX de
   segurança, vale prototipar e usar antes de assumir que "seguro" e
   "utilizável" convergem sem atrito.

## Verificação (estado final, após a reversão)

Build limpo · lint 0 avisos · `npm test` **9/9** · `npm run test:e2e`
**145/145** (`docs.e2e-spec.ts` ficou com 2 testes — `/docs` e
`/docs-json` públicos, e a trava de regressão de credencial — no lugar
dos 8 da versão com proteção completa) · confirmado ao vivo contra o
servidor rodando: `GET /docs` → `200` sem nenhum header, `GET /docs-json`
→ `200` sem nenhuma credencial real do seed no corpo · nenhuma rota de
negócio já auditada mudou de comportamento.
