# Pacote para revisão — Qwen (QA Lead & DevSecOps) — Fase 4, Rodada 13 (reapresentação)

Cole este documento inteiro na conversa com o Qwen.

---

Você é o **QA Lead / DevSecOps Specialist** do projeto `recrutamento-api`.
Na Rodada 12, você **reprovou** os 5 módulos da Fase 4 (Application,
Interview, Document, Users, RBAC Nível B) com 6 críticos: K1 (`HIRED` ×
redução de `vacancies` quebrando o invariante `filledCount <= vacancies`
em 60% de 25 corridas), K2 (trava "último papel com `role:manage`"
furada por 2 `PUT` simultâneos, 83%), K3 (mesma corrida na trava "último
ADMIN ativo" de `PATCH /users/:id/role`, 83%), K4 (`PATCH
/users/:id/company` com `{}` → `500`), K5 (`isCompanyOperable()` faltando
em Applications/Interviews/Documents — recrutador de empresa desativada
mantinha acesso total, inclusive download de arquivo real), K6 (escopo
de `Document` liberando todos os documentos de um candidato, não só os
anexados). Relatório completo em `PARECER-QWEN-FASE4-RODADA12.md`; nossa
resposta em `TRIAGEM-REVISOES-RODADA12.md`. Esta é a reapresentação.

## O que foi corrigido

| Achado | Correção | Como validamos |
|---|---|---|
| **K1** (crítico) — comparação coluna×parâmetro em vez de coluna×coluna | `hireWithCapacityCheck()` reescrito com `$executeRaw` parametrizado: `UPDATE "Job" SET "filledCount" = "filledCount" + 1 WHERE id = $1 AND "filledCount" < "vacancies"`. Adicionado `CHECK ("filledCount" <= "vacancies" AND "filledCount" >= 0)` via nova migration (`20260922191931_add_job_filledcount_check`) — item do Gate Fase 3 pendente desde a Fase 1 | Teste novo: reduzir `vacancies` de 3→2 concorrendo com uma 3ª contratação, 5 rodadas, `filledCount <= vacancies` sempre ao final |
| **K2** (crítico) — contagem de "outros papéis com role:manage" fora da transação | `RolesService.updatePermissions()`: contagem + escrita movidas pra dentro de `$transaction(callback, {isolationLevel: 'Serializable'})` — mesmo mecanismo de `deactivate()` | Teste e2e novo: 5 rodadas, 2 papéis custom com `role:manage`, 2 `PUT` simultâneos removendo de cada, nunca zera o sistema (ADMIN temporariamente sem a key durante o teste, restaurado em `finally`) |
| **K3** (crítico) — mesma corrida em `updateRole()` | Envolvido no mesmo invólucro `$transaction(..., {isolationLevel: 'Serializable'})` | Teste e2e novo: 5 rodadas com exatamente 2 admins ativos isolados, 2 `PATCH .../role` simultâneas, nunca zera admins ativos |
| **K4** (obrigatória) — `{}` → `500` | `updateCompany()` rejeita `companyId === undefined` com `400 company_id_obrigatorio`, distinto de `null` (válido) | Teste novo: `{}` → `400`, nunca `500` |
| **K5** (crítico) — `isCompanyOperable()` faltando em 3 módulos | Importado em `ApplicationsService`, `InterviewsService`, `DocumentsService` — cada um com seu próprio 404 (anti-enumeração preservada) | Testes novos nos 3 specs: empresa desativada → `404` em toda rota de leitura/escrita do recrutador |
| **K6** (crítico) — escopo de `Document` largo demais | Removida a branch `{candidateId: document.ownerId}` — só `{resumeDocumentId: id}` conta | Teste novo: documento anexado → acessível; documento nunca anexado do mesmo candidato → `404` mesmo com candidatura qualificada |

## Mudança de infraestrutura

`vitest.config.e2e.ts` ganhou `fileParallelism: false` — arquivos de
teste e2e agora rodam em sequência, não em paralelo. Necessário pra
provar K3 sem risco de `auth.e2e-spec.ts` (que já mexe na contagem
global de admins ativos) interferir. Custo: suíte de ~13s pra ~35s.

## Adiado conscientemente (registrado, sem mudança de destino)

11 ressalvas do relatório original (`interviewerId` sem validação,
`scheduledAt` no passado aceito, campos de `Interview` inalcançáveis pela
API, `updateCompany` sem guardas de `isActive`/vagas ativas, MIME
confiando no cliente, ciclo de vida do arquivo órfão, mojibake em
`originalName`, corpo do `500` sem `error`, `findOne` sem `@Permissions`
em metadata) — nenhuma bloqueante pra reapresentação segundo seu próprio
relatório ("antes da Fase 5"), registradas em `TRIAGEM-REVISOES-RODADA12.md`.

## Verificação

`npm run build` limpo · `npm run lint` 0 avisos · `npm test` 6/6 ·
`npm run test:e2e` 139/139 (**145 no total**), rodado 3× seguidas sem
falha, agora em sequência (não mais em paralelo entre arquivos) · os 6
críticos reproduzidos com o mesmo tipo de prova que você usou
(concorrência real via `Promise.all`, invariante no banco depois — nunca
"exatamente um 200").

## O que eu preciso de volta

Mesmo formato de sempre. Peço em particular: (1) confirmar que a
comparação coluna×coluna do K1 fecha o invariante mesmo com mais de 2
requisições concorrentes ou `vacancies` mudando mais de uma vez em voo;
(2) atacar K2/K3 com mais rodadas se possível, já que 5 é bem menos que
as 12 que você usou pra encontrá-los originalmente; (3) confirmar que a
restrição do escopo de `Document` (K6) não ficou estrita demais a ponto
de quebrar algum caso de uso legítimo que o mapa do DeepSeek previa.
