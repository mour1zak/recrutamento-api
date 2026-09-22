# Triagem das revisões — Qwen rodada 12 (Fase 4 — REPROVADO → corrigido)

Resposta a `PARECER-QWEN-FASE4-RODADA12.md`. Mesma legenda: ✅ aceito e
corrigido · 📋 aceito, planejado pra fase futura · ⏸️ registrado, sem ação
agora · ⚖️ discordamos.

## Críticos — todos corrigidos nesta rodada

| ID | Item | Correção | Como validamos |
|---|---|---|---|
| K1 | `filledCount < vacancies` comparava coluna×parâmetro (valor lido antes da transação), não coluna×coluna | `hireWithCapacityCheck()` reescrito com `$executeRaw` parametrizado: `UPDATE "Job" SET "filledCount" = "filledCount" + 1 WHERE id = $1 AND "filledCount" < "vacancies"` — comparação sempre contra o valor real no instante da escrita. Adicionado também `CHECK ("filledCount" <= "vacancies" AND "filledCount" >= 0)` via nova migration, como rede de segurança (dispara `409` sozinho pelo mapeamento de SQLSTATE já existente desde a rodada 7) | Teste novo reproduzindo o cenário exato do relatório: reduzir `vacancies` de 3→2 concorrendo com a 3ª contratação, 5 rodadas, sempre `filledCount <= vacancies` ao final. Confirmado que o `CHECK` rejeita estados inconsistentes até em escrita direta via SQL |
| K2 | Contagem de "outros papéis com `role:manage`" fora da transação de escrita | `RolesService.updatePermissions()`: contagem + `deleteMany`/`createMany` movidos pra dentro de um único `$transaction(callback, {isolationLevel: 'Serializable'})` — mesmo mecanismo já provado em `UsersService.deactivate()` | Teste e2e novo: 5 rodadas de 2 papéis custom com `role:manage`, dois `PUT` simultâneos removendo de cada, nunca zera o sistema inteiro. `ADMIN` temporariamente sem `role:manage` durante o teste, restaurado em `finally` — seguro porque `vitest.config.e2e.ts` passou a rodar arquivos de teste em sequência (`fileParallelism: false`, mudança desta rodada) |
| K3 | Mesma corrida em `UsersService.updateRole()` (contagem de admins ativos fora de transação) | Envolvido no mesmo invólucro `$transaction(..., {isolationLevel: 'Serializable'})` que `deactivate()` já usa — o comentário anterior dizia "mesma trava" mas só copiou a regra, não o invólucro | Teste e2e novo: 5 rodadas com exatamente 2 admins ativos isolados (outros admins, inclusive o do seed, temporariamente desativados e restaurados em `finally`), duas `PATCH .../role` simultâneas tirando ADMIN dos dois, nunca zera admins ativos |
| K4 | `PATCH /users/:id/company` com `{}` → `500` (`undefined` tratado como `null` pelo `@IsOptional()`, chegava em `company.findUnique({where:{id: undefined}})`) | `UsersService.updateCompany()` agora rejeita `companyId === undefined` explicitamente com `400 company_id_obrigatorio`, antes de qualquer query — distingue de `null` (valor válido, desvincula) | Teste novo: `PATCH /users/:id/company` com `{}` → `400`, nunca `500` |
| K5 | `isCompanyOperable()` extraído na rodada 11 nunca foi importado em Applications/Interviews/Documents | Importado e aplicado em `ApplicationsService` (`findForJob`, `findOne`, `findScopedForRecruiterOrThrow`), `InterviewsService` (`create`, `findForApplication`, `findScopedOrThrow`) e `DocumentsService` (`findScopedOrThrow`) — cada um lançando seu próprio 404 (`application_not_found`/`interview_not_found`/`document_not_found`), preservando a anti-enumeração | Testes novos nos 3 specs: empresa desativada → `404` em todas as rotas de leitura/escrita do recrutador (lista, detalhe, mudança de status/entrevista, download de documento) |
| K6 | Escopo de `Document` aceitava `{candidateId: document.ownerId}` — qualquer candidatura qualificada liberava TODOS os documentos do candidato | Removida a branch — só `{resumeDocumentId: id}` conta, expressando "documento anexado A ESTA candidatura", não "qualquer documento deste candidato" | Teste novo: documento anexado → acessível com candidatura `UNDER_REVIEW`; documento nunca anexado do MESMO candidato → continua `404` mesmo com a mesma candidatura qualificada |

## Ressalvas — destino

| ID | Item | Veredito | Detalhe |
|---|---|---|---|
| 1, 2, 3, 5, 8 | `interviewerId` sem validação, `scheduledAt` no passado, campos de `Interview` inalcançáveis, guardas de `updateCompany`, mojibake de `originalName` | 📋 | Registradas para antes da Fase 5 — não bloqueiam a reapresentação (Qwen agrupou como "condições futuras", não críticos), e o orçamento de tempo desta rodada foi dedicado integralmente aos 6 críticos + suas provas de concorrência |
| 4, 6, 7, 9, 10, 11 | Listagem expõe mais que reduzido, MIME confia no cliente, ciclo de vida do arquivo órfão, `CHECK` (✅ já corrigido junto com K1), corpo do 500 sem `error`, `findOne` sem `@Permissions` em metadata | 📋 | Sem mudança nesta rodada — destino registrado |

## Mudança de infraestrutura de teste (efeito colateral desta rodada)

`vitest.config.e2e.ts` ganhou `fileParallelism: false`. Motivo: provar K3
de verdade exige isolar o número exato de admins ativos no sistema
inteiro — com arquivos de teste rodando em paralelo (padrão do Vitest),
`auth.e2e-spec.ts` (que já testa a mesma trava em `deactivate()` com
admins temporários próprios) poderia estar alterando essa contagem global
ao mesmo tempo, tornando qualquer teste de agregado global não confiável.
Custo: suíte e2e completa foi de ~13s para ~35s. Considerado aceitável —
correção determinística vale mais que velocidade aqui, e o número
absoluto continua rápido.

## Verificação

Build limpo · lint 0 avisos · `npm test` 6/6 · `npm run test:e2e`
**139/139** (**145 no total**), rodado 3× seguidas sem falha, agora em
sequência (não mais em paralelo entre arquivos) · os 6 críticos
reproduzidos com o mesmo tipo de prova que o Qwen usou (concorrência real
via `Promise.all`, invariante no banco depois — nunca "exatamente um
200").
