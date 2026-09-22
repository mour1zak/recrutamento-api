# Pacote para revisão — Qwen (QA Lead & DevSecOps) — Interceptor obrigatório (pós Fase 4, Rodada 13)

Cole este documento inteiro na conversa com o Qwen.

---

Você é o **QA Lead / DevSecOps Specialist** do projeto `recrutamento-api`.
Na Rodada 13, você aprovou a Fase 4 com ressalvas (fechada). Este pacote
é sobre um item isolado, pequeno, adicionado depois: o único requisito
**obrigatório** do enunciado que ainda faltava — "ao menos um interceptor
útil". Não é uma nova fase nem mexe em nenhuma regra de negócio já
auditada; é uma peça de infraestrutura transversal, por isso o escopo de
revisão pedido aqui é bem mais estreito que os pacotes anteriores.

## O que existe pra revisar

`src/common/interceptors/logging.interceptor.ts` — um `NestInterceptor`
registrado globalmente via `APP_INTERCEPTOR` em `app.module.ts` (mesmo
padrão de `ApiKeyGuard`/`JwtAuthGuard`/`PermissionsGuard`/
`GlobalExceptionFilter`, todos já auditados). Roda em **toda** requisição
que passa pela aplicação.

O que ele faz: depois que a requisição é resolvida (sucesso ou erro),
loga uma linha `${method} ${url} ${statusCode} ${duração}ms${user=id, se
autenticado}` via `Logger('HTTP')` do NestJS. Não loga body, query nem
headers — só esses 5 metadados.

## Por que essa restrição de escopo (nunca logar corpo)

Decisão deliberada, pelo mesmo motivo do `omit` global do Prisma
(`password`/`tokenHash` nunca saem em nenhuma resposta) e do
`SEED_USER_PASSWORD` nunca impresso no seed: um interceptor de logging
"esperto" que loga o corpo da requisição inteira vazaria senha (em
`/auth/register`/`/auth/login`) e qualquer dado sensível de PII
(telefone, endereço) direto pro log — que geralmente tem retenção maior e
menos controle de acesso que o banco. Preferimos um interceptor mais
burro e seguro a um mais "útil" e arriscado.

## Como está testado

3 testes unitários novos (`logging.interceptor.spec.ts`, com
`ExecutionContext`/`CallHandler` mockados):
1. Resposta de sucesso passa pelo interceptor sem o valor ser alterado.
2. Loga método/rota/status/duração/id do usuário quando autenticado.
3. Erro lançado pelo `handle()` é propagado adiante (o interceptor não
   engole exceção) e ainda assim gera o log, com o status do erro.

Suíte completa (build/lint/unit/e2e) rodada de novo depois da mudança,
já que um interceptor global pode teoricamente afetar QUALQUER rota:
`npm run build` limpo · `npm run lint` 0 avisos · `npm test` **9/9** ·
`npm run test:e2e` **139/139** (sem nenhuma regressão nas 139 rotas já
cobertas, incluindo os testes de concorrência de K1/K2/K3 que a Fase 4
fechou na rodada 13 — um interceptor mal feito poderia introduzir latência
ou reordenar side-effects o suficiente pra desestabilizar aquelas provas
de corrida, e não aconteceu).

## Pontos que gostaríamos que você atacasse especificamente

1. **Vazamento indireto:** mesmo sem logar o corpo, `url` inclui query
   string — alguma rota do projeto hoje passa dado sensível por query
   param (o que já seria um problema por si só, mas o interceptor
   tornaria pior ao persistir isso em log)?
2. **Timing attack / side-channel:** o log inclui duração em ms. Alguma
   rota tem timing distinguível o suficiente (ex.: comparação de senha,
   verificação de token) pra um atacante inferir algo observando os logs
   (se ele tivesse acesso a eles)?
3. **Efeito em concorrência:** o interceptor usa `Date.now()` e RxJS
   `tap` — alguma chance de introduzir uma condição de corrida nova, ou
   interferir na ordem de efeitos colaterais dos `$transaction` que as
   rodadas 12/13 corrigiram?
4. **Suficiência:** "interceptor útil" no enunciado é subjetivo — este
   nível de logging (metadados de requisição HTTP) atende ao espírito do
   requisito, ou você esperaria algo com mais valor de produto (ex.: um
   interceptor de transformação de resposta, cache, ou retry)?

## Verificação

`npm run build` limpo · `npm run lint` 0 avisos · `npm test` 9/9 ·
`npm run test:e2e` 139/139 · nenhuma mudança em nenhuma rota já auditada
— só a adição do interceptor global e seus 3 testes novos.
