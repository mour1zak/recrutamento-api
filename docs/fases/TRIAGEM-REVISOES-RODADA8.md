# Triagem das revisões — Qwen rodada 8 (Fase 3, Domínio: Companies + Jobs)

Resposta do time a `PARECER-QWEN-FASE3-DOMINIO-RODADA8.md`. Mesma
legenda: ✅ aceito e corrigido · 📋 aceito, planejado pra fase futura ·
⏸️ registrado, sem ação agora · ⚖️ discordamos.

## Críticos — todos corrigidos nesta rodada

| ID | Item | Veredito | Correção |
|---|---|---|---|
| C1 | `companyId: null` = acesso global; seed entregava RECRUITER assim | ✅ | `hasJobScope()` novo (único ponto de decisão de escopo do módulo, substitui as 3 respostas divergentes) trata "sem empresa e não-ADMIN" como fora de escopo; `resolveCompanyIdForCreate()` ganhou a checagem que faltava (lança `job_not_found` antes de cair no ramo ADMIN); `prisma/seed.ts` agora cria uma "Empresa Seed" e vincula o RECRUITER a ela (`upsert` com `update: {companyId}`, corrige também bancos já semeados antes). **Testado com o usuário real do seed** (`recrutador@recrutamento.test`, não fabricado): `PATCH`/`PATCH .../status`/`GET`/`POST` em vaga/empresa alheia → `404` nos quatro, confirmado por execução automatizada (`test/jobs.e2e-spec.ts`, describe "C1") e manualmente contra o servidor de dev, reproduzindo o ataque exato do relatório. |
| C2 | Corrida check-then-write sobrescrevia estado terminal (13/25) | ✅ | `updateStatus()` reescrito com `prisma.job.updateMany({where: {id, status: job.status}, ...})` — mesmo primitivo já provado em `AuthService.refresh()` (Fase 2). Se outra transição mudou o status entre a leitura e esta escrita, `count === 0` e devolve `409 status_changed_concurrently`, nunca aplica por cima. Mesma correção aplicada preventivamente em `update()` (vacancies/filledCount), que tinha a mesma forma. Testado com `Promise.all` de duas transições simultâneas (`CANCELED`/`PAUSED` a partir de `OPEN`): exatamente uma responde `200`, a outra `409`/`400`, e o banco reflete só a vencedora — nunca as duas aplicadas. |
| C3 | Empresa desativada não impedia recrutadores de operar vagas | ✅ | Decisão explícita (uma das duas opções do Qwen): `isActive` da empresa passa a ser checado em toda escrita de vaga — `resolveCompanyIdForCreate()` agora chama `assertCompanyActiveOrThrow()` também no ramo RECRUITER (antes só existia no ramo ADMIN); `findScopedOrThrow()` (usado por `update`/`updateStatus`) inclui a empresa e recusa se `!company.isActive`. Leituras de vagas já `OPEN` não são afetadas retroativamente (decisão registrada: desativar empresa não esconde vagas já publicadas). Testado: recrutador de empresa recém-desativada → `404` em criar/publicar vaga; vaga já `OPEN` da mesma empresa continua na vitrine pública (comportamento esperado, testado explicitamente). |

## Ataque 3 (vazamento) — confirmado limpo, contrato corrigido

| Item | Veredito | Correção |
|---|---|---|
| Dois formatos de `409` (com/sem `error`) | ✅ | `errorBody()` agora inclui `error` (usando o mesmo dicionário `STATUS_TEXT`, movido para `error-body.util.ts` e importado por `global-exception.filter.ts` — uma fonte só). |
| `403` sem `reason` | ✅ | `PermissionsGuard` agora lança `errorBody(403, 'permission_denied', ...)`. |
| `company_already_inactive`/`company_already_active` em `404` | ✅ | Migrados para `409` (`ConflictException`) — o recurso existe, o conflito é de estado. Fecha também o canal de enumeração de baixa severidade que o Qwen apontou. |

## Ressalvas — destino

| ID | Item | Veredito | Detalhe |
|---|---|---|---|
| R1 | Sem `include`/`select` de `company` nas respostas de vaga | ✅ | `GET /jobs`, `GET /jobs/:id` e `GET /jobs/mine` agora incluem `company: {id, name}`. |
| R5 | Vitrine pública expunha `createdById`/`filledCount` | ✅ | `PUBLIC_JOB_SELECT` dedicado só pra `GET /jobs` (lista pública), sem esses dois campos — `/jobs/mine` e `/jobs/:id` autenticados continuam com os campos completos. |
| R3 | `search` não escapava curingas de `LIKE` | ✅ | `escapeLikeWildcards()` escapa `%`, `_` e `\` antes do `contains`. |
| R4 | `OPEN→CLOSED` sumiu, contradizendo o comentário do enum | ✅ | Reincluída em `VALID_TRANSITIONS['OPEN']` — alinha a máquina de estados com o comentário original do `schema.prisma` ("CLOSED: encerrada definitivamente sem preencher todas as vagas"). |
| R2 | Listagem pública sem JWT, detalhe exige JWT | 📋 | Registrado em `CONDICOES-ENTRADA-FASE2.md` — decisão a tomar antes da Fase 5 (tornar `GET /jobs/:id` também público pra vagas `OPEN`, ou deixar de expor a listagem sem login). Não bloqueia porque nenhuma das duas opções tem risco de segurança, só de UX. |
| — | `GET /companies/:id` sem escopo (qualquer `company:read` lê qualquer empresa) | ⏸️ | Aceito como está — hoje é ADMIN+RECRUITER e o dado é semi-público. Registrado para reavaliar quando `Application` tocar em dado de candidato entre empresas (mesmo padrão, risco maior). |
| — | N9 (rate limiting), `CHECK` de `filledCount` | 📋 | Sem mudança — continuam pré-requisito da Fase 3 (concorrência), agora com prioridade reforçada pelo Qwen (`GET /jobs` público + `search` não indexado). |

## Sugestões — destino

1. Teste de isolamento com o usuário do seed — ✅ implementado (describe "C1" em `test/jobs.e2e-spec.ts`), e vira prática padrão pros próximos módulos.
2. Teste de concorrência de transição de status — ✅ implementado (describe "C2").
3. Helper único de escopo (`assertJobScope`) — ✅ implementado como `hasJobScope()`, usado por `findOne`/`update`(via `findScopedOrThrow`)/`updateStatus`(via `findScopedOrThrow`)/`findMine`.
4. `select` nomeados `as const` por módulo — ✅ `PUBLIC_JOB_SELECT`/`SCOPED_JOB_INCLUDE` criados; adotar em `Companies` e módulos futuros.
5. Invariante de banco `RECRUITER ⇒ companyId NOT NULL` — 📋 registrado em `FEEDBACKS-MELHORIA.md` como item a considerar antes da Fase 3 (concorrência) — exige trigger (Postgres não suporta `CHECK` com subquery entre tabelas), custo maior que os outros itens desta rodada, não implementado agora para não atrasar a reapresentação.

## Verificação

Build limpo · lint 0 avisos · **59 testes automatizados** (55 e2e + 4
unitários; era 49 no total antes desta rodada — +10 novos cobrindo
C1/C2/C3/R1/R5) · confirmado manualmente contra o servidor de dev
reproduzindo o ataque exato do relatório (C1 e C3) — os três críticos
voltam `404`/`409` onde antes retornavam `200`/`201`.
