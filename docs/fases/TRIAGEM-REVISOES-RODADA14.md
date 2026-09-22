# Triagem das revisões — Qwen rodada 14 (Interceptor — REPROVADO → corrigido)

Resposta a `PARECER-QWEN-INTERCEPTOR-RODADA14.md`. Mesma legenda: ✅
aceito e corrigido · 📋 aceito, planejado pra fase futura · ⏸️ registrado,
sem ação agora.

## Bloqueante — corrigido nesta rodada

| Item | Correção | Como validamos |
|---|---|---|
| Asserção exclusiva demais no teste de concorrência K2 | `test/roles.e2e-spec.ts`: trocado `expect(res.body.reason).toBe('concorrencia_transacao')` por `expect([...]).toContain(res.body.reason)`, aceitando os dois desfechos legítimos (`sem_papel_com_role_manage` E `concorrencia_transacao`). Comentário no teste registra a regra geral: "assertar invariante no banco + conjunto de códigos/reasons aceitos, nunca o desfecho de um ramo único" | Suíte completa rodada **8× seguidas** (não 3, dado que o Qwen mediu 92% de falha isolada) — 139/139 em todas. `roles.e2e-spec.ts` isolado rodado **6× seguidas** — 8/8 testes passando em todas. 14 execuções limpas no total, mesma ordem de rigor que o Qwen usou pra encontrar o problema (12 rodadas isoladas) |

## Antes da Fase 5 — corrigido nesta rodada (adiantado, não só registrado)

| Item | Correção | Como validamos |
|---|---|---|
| R1 — rejeições de guard/rota sem log nenhum | `GlobalExceptionFilter` ganhou `logger.warn()` em dois pontos: dentro de `respond()` (cobre `PayloadTooLarge`, conflito de transação, erros do Prisma, `UnauthorizedException` dos guards) e antes de `super.catch()` (cobre `ForbiddenException` do `PermissionsGuard` e rota inexistente). Docstring do `LoggingInterceptor` e README §2.1 corrigidos pra não afirmar mais "toda requisição" sem qualificar — agora explicam que interceptor + filtro juntos cobrem isso | Revisão de código; os mesmos 5 cenários que o Qwen mediu (401 sem key, 401 sem JWT, 401 JWT inválido, 403 sem permissão, 404 rota inexistente) agora passam pelo `logRejection()` do filtro |
| R6 — README afirmava "100%"/"10 de 10" com suíte vermelha | Não precisou de mudança de texto — a suíte agora está genuinamente verde (ver acima), então a afirmação voltou a ser verdadeira. Registrado aqui como lição: a mesma classe de erro (documentação otimista descolada da execução real) apareceu de novo, quarta vez desde a rodada 4 | Verificação por execução, não por leitura |

## Desejável — registrado, sem ação agora

R2 (duração exclui tempo de guard), R3 (URL sem limite de tamanho no
log), R4 (sem redação de query param com cara de segredo), R5
(requisição abortada não gera log, falta `finalize`) — todas registradas
em `FEEDBACKS-MELHORIA.md`, nenhuma crítica, custo baixo mas fora do
orçamento desta correção pontual.

## Lição de processo registrada

É a terceira vez que uma asserção de teste de concorrência falha por
testar "qual desfecho aconteceu" em vez de "o invariante se manteve"
(rodada 9, N2; agora). Regra escrita a partir de agora pra qualquer teste
de concorrência novo neste projeto: **assertar o estado final no banco +
o conjunto de códigos/reasons aceitos; nunca o número exato de sucessos
nem o motivo específico de um único ramo**, exceto quando há certeza
estrutural de que só um caminho é possível (ex.: K3 em `users.e2e-spec.ts`
foi medido pelo próprio Qwen como determinístico, mas mesmo lá a
asserção já usava `toContain`, não `toBe`).

## Verificação

Build limpo · lint 0 avisos · `npm test` 9/9 · `npm run test:e2e`
**139/139**, rodado **8× seguidas** (mais **6× isoladas** de
`roles.e2e-spec.ts`, o arquivo que motivou a reprovação) — **14
execuções limpas no total**, sem nenhuma falha.
