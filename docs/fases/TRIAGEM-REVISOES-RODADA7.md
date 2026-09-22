# Triagem das revisões — Qwen rodada 7 (Fase 2, Auth)

Resposta do time a `PARECER-QWEN-FASE2-AUTH-RODADA7.md`. Mesma legenda:
✅ aceito e corrigido · 📋 aceito, planejado pra fase futura · ⏸️ registrado,
sem ação agora · ⚖️ discordamos.

## Confirmações (nada a corrigir)

| ID | Item | Status |
|---|---|---|
| N1-a | Trava de último admin sob 5 formatos de ataque | ✅ Confirmado fechado — nenhuma ação necessária |
| N5-a | `prisma generate`/`test:e2e`/`build` sem `DATABASE_URL` real | ✅ Confirmado fechado, inclusive além do que tínhamos medido |
| N1-c, N1-d, #7, #8, #10, #11 (rodada 6) | Todos re-verificados por execução | ✅ Sem regressão |

## Crítico novo — corrigido nesta rodada

| Item | Veredito | Correção |
|---|---|---|
| `db:reset:test` podia apagar o banco errado se `DATABASE_URL` já estivesse exportada no shell (`dotenv run` não sobrescreve por padrão) | ✅ | Reescrito como `scripts/db-reset-test.ts` (rodado via `tsx`, chamado pelo mesmo `npm run db:reset:test`): 1) lê `.env.test` e monta o `env` do processo filho com esses valores **sempre por cima** de qualquer coisa herdada do shell (o `--override` que faltava, implementado manualmente); 2) recusa rodar se o nome do banco alvo não contiver `"test"`. **Testado reproduzindo exatamente o cenário do Qwen:** criamos um banco canário (`recrutamento_canary_verify`) com uma tabela marcadora, exportamos `DATABASE_URL` apontando pra ele, rodamos `npm run db:reset:test` — o log confirmou `Datasource "db": ... "recrutamento_test"` (não o canário), e depois confirmamos por query direta: canário com 1 linha intacta, `recrutamento_test` com 3 roles (resetado e reseedado). Canário removido ao final. |

## Antes da Fase 3 — corrigido nesta rodada (adiantado)

| Item | Veredito | Correção |
|---|---|---|
| `CHECK`/`unique` violado via SQL cru (`P2010`) e via client (`P2039`) caindo no `default` → `500` | ✅ | `global-exception.filter.ts`: novo fallback no `default` do switch, lendo o SQLSTATE real (`meta.driverAdapterError.cause.originalCode`) e classificando por classe — `23505`/`23514` → `409`, `23503`/`23502` → `400`. **Testado reproduzindo o repro exato do Qwen:** criamos temporariamente `CHECK (filledCount <= vacancies AND filledCount >= 0)` em `Job` (via `$executeRawUnsafe`, sem tocar a migration — o `CHECK` em si continua sendo item da Fase 3), violamos via SQL cru (`P2010`/`23514`) e via client (`P2039`/`23514`), confirmamos que o filtro agora devolve `409` nos dois casos, e violamos um `unique` via SQL cru (`P2010`/`23505`) — também `409`. Constraint removida ao final, zero resíduo confirmado em `pg_constraint`. |
| `P2020` (`Int` estourado) caindo no `default` → `500` | ✅ | `case 'P2020'` explícito adicionado, devolve `400`. |
| SQLSTATEs retryáveis de lock/deadlock/timeout (`40P01`, `55P03`, `57014`) — risco sinalizado, não medido pelo Qwen | ✅ | Incluídos preventivamente no mesmo conjunto `SQLSTATE_CONFLICT` (→ `409`) — mesmo custo de implementação que os já medidos, e exatamente os erros que uma fila de `SELECT ... FOR UPDATE` (Fase 3) pode produzir. |
| N9 (rate limiting), N15 (pool do `pg`) | 📋 | Sem mudança — continuam pré-requisito antes da Fase 3, já registrados desde a rodada 5. |

Também atualizado: `CONDICOES-ENTRADA-FASE2.md` (Gate Fase 3) ganha o
item novo pedido pelo Qwen — "o `CHECK` disparando produz `409`, não
`500`" — já marcado como resolvido antecipadamente, com a ressalva de
que o teste automatizado desse cenário específico (sugestão 1 do Qwen)
fica para quando o `CHECK` de verdade entrar na migration da Fase 3.

## Ressalvas menores — destino

| ID | Item | Veredito | Detalhe |
|---|---|---|---|
| Dois formatos de corpo `500` | 📋 | Adiado deliberadamente: a correção certa envolve mexer no caminho de erro **verdadeiramente desconhecido** que hoje delega pra `super.catch()` (o `@Catch()` catch-all do Nest, que também loga a exceção) — não quisemos arriscar perder esse logging sob pressão de tempo. Registrado para antes da Fase 5. |
| README §2.1 sem `reactivate` | ✅ | Linha corrigida para citar as duas rotas (`deactivate`/`reactivate`). |
| Método não suportado → `404` em vez de `405` | ⏸️ | Comportamento padrão do Nest/Express, não é defeito nosso — registrado, sem ação. |
| `reactivate` sem trava — assimetria não documentada | ⏸️ | O comentário de `reactivate()` já existente já explica o raciocínio (não há risco de "zerar admins" no caminho oposto, idempotência é aceitável) — avaliado como suficiente; nenhuma reescrita necessária. |
| `engines: node>=22` gera aviso em Node 20 | ⏸️ | Não é defeito — vira relevante só quando houver CI de verdade (ainda não existe, `FEEDBACKS-MELHORIA.md` #14). |

## Sugestões — destino

1. Teste automatizado que viola o `CHECK` de propósito e assere `409` —
   📋 fica para quando a Fase 3 adicionar o `CHECK` na migration (hoje ele
   só existe temporariamente durante a verificação manual desta rodada).
2. Tabela única de SQLSTATE→HTTP em vez de casos espalhados — ✅ já é
   exatamente como a correção acima foi implementada (`SQLSTATE_CONFLICT`/
   `SQLSTATE_BAD_REQUEST`).
3. `db:reset:dev` explícito, espelhando `db:reset:test` — 📋 registrado em
   `FEEDBACKS-MELHORIA.md`; não criado agora porque é um script novo com
   potencial de apagar dados de desenvolvimento e o padrão do projeto é
   não criar esse tipo de ferramenta sem alinhar antes com o usuário.
4. CI mínimo — reforçado o registro já existente (`FEEDBACKS-MELHORIA.md`
   #14): teria pego a Parte 3 e a ressalva do README.
