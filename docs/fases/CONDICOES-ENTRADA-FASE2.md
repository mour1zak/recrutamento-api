# Condições de Entrada — Fase 2

Checklist de aceite construído a partir do parecer do Qwen (rodada 3,
`PARECER-QWEN-FASE1-RODADA3.md`) e do DeepSeek. Existe para que nenhuma
exigência vire "promessa esquecida" — o próprio Qwen citou isso como risco.
Marcar conforme for implementado; não avançar para os itens de "Gate Fase 3"
sem os de "Passo 1" resolvidos.

## Adendo rodada 4 (auditoria de código, não mais só schema) — REPROVADO → corrigido

O primeiro código de aplicação auditado (módulo de auth) trouxe 5 achados
críticos reproduzidos por execução real — ver
`PARECER-QWEN-FASE2-AUTH-RODADA4.md` e `TRIAGEM-REVISOES-RODADA4.md` para
o relato completo. Todos corrigidos e reverificados nesta rodada:

- **Bypass de autenticação com segredo placeholder** — `src/config/env.validation.ts` agora recusa o boot se `JWT_SECRET`/`API_KEY` forem os valores do `.env.example`.
- **Ordem dos guards quebrada** (`PermissionsGuard` rodava antes do `JwtAuthGuard`) — `JwtAuthGuard` virou global, com `@Public()` nas rotas de auth.
- **Suíte e2e vermelha, README mentindo** — corrigida, `.env.test` versionado, 12 testes verdes.
- **Rotação de refresh token não atômica** — `updateMany` condicional, provado com 10 requisições concorrentes.
- **`deactivate()` sem chamador** — `UsersController` criado.

Isso muda o status de dois itens abaixo (marcados com "🔄 rodada 4").

## Adendo rodada 5 — APROVADO COM RESSALVAS

Os 5 críticos + 2 ressalvas da rodada 4 foram reexecutados pelo Qwen sob
carga maior que a nossa e confirmados fechados. Um crítico **novo**
apareceu, criado indiretamente pela própria correção do C5 (o endpoint de
desativação de usuário, que não existia antes): **o último ADMIN
conseguia se autodesativar, sem rota de reversão**. Corrigido — ver
`TRIAGEM-REVISOES-RODADA5.md`. Duas ressalvas obrigatórias também
fechadas: mensagem do 409 nomeando o campo certo, e erro de infraestrutura
(`P1xxx`) deixando de ser classificado como conflito de dado.

## Adendo rodada 6 — APROVADO COM RESSALVAS (fecha a Fase 2)

A trava de último administrador (N1, rodada 5) foi reexecutada sob carga
adversarial ainda maior e **se sustentou** — o problema não era a regra de
negócio, era o formato do erro que ela produzia sob a colisão real: o
conflito de transação `Serializable`, no Prisma 7 com driver adapter,
chega como um `DriverAdapterError` não exportado
(`cause.kind === 'TransactionWriteConflict'`), nunca como
`PrismaClientKnownRequestError` com `code: 'P2034'` — o filtro antigo
nunca reconhecia esse formato, e o conflito caía como `500` cru em 67%
das corridas medidas. Ver `PARECER-QWEN-FASE2-AUTH-RODADA6.md` e
`TRIAGEM-REVISOES-RODADA6.md` para o relato completo. Corrigido:

- **`500` em conflito de concorrência real (N1-a)** — os dois filtros de
  exceção antigos (`PrismaExceptionFilter`, `UnauthorizedExceptionFilter`)
  foram substituídos por um único `GlobalExceptionFilter`
  (`src/common/filters/global-exception.filter.ts`), que reconhece o
  `TransactionWriteConflict` por duck-typing **antes** de qualquer outra
  checagem e devolve `409`. Provado com um teste e2e dedicado: 8 admins
  temporários, 4 pares de desativação mútua simultânea, `14/14` testes
  verdes em 3 execuções consecutivas, zero `500`.
- **`prisma generate` falhando sem `DATABASE_URL` (N5-a)** — bloqueava
  clone novo/CI antes mesmo do primeiro build. `prisma.config.ts` agora
  tolera a variável ausente (`generate` não conecta em banco nenhum).
- **Sem rota de reversão de `deactivate()` (N1-c)** — `PATCH
  /users/:id/reactivate` criado.
- Ressalvas de custo baixo também fechadas nesta rodada: comentário
  impreciso do mecanismo de trava (N1-d), formato inconsistente do `401`
  entre rotas (#7, absorvido pelo filtro unificado), falso-positivo de
  lint não suprimido por comentário inline (#8, resolvido via
  `.oxlintrc.json`), log duplicado por request de key de permissão órfã
  (#10), mensagem genérica do `P2025` (#11, resolvido no mesmo filtro
  unificado). Suíte e2e agora reentrante via `npm run db:reset:test`
  (#9).

Este adendo fecha a Fase 2 do ponto de vista da auditoria adversarial —
os itens "Gate Fase 3" abaixo continuam sendo os requisitos de entrada
para a próxima fase, não itens desta.

## Adendo rodada 7 — APROVADO COM RESSALVAS (Fase 2 fechada de vez)

N1-a e N5-a (rodada 6) reexecutados sob carga adversarial ainda maior (5
formatos de ataque diferentes contra a trava de último admin, incluindo
20 pares simultâneos e um ciclo de 4 admins) — **zero `5xx`**, invariante
nunca violado. Nenhuma falha crítica em produto nesta rodada. Ver
`PARECER-QWEN-FASE2-AUTH-RODADA7.md` e `TRIAGEM-REVISOES-RODADA7.md`.

Dois achados corrigidos, ambos fora do comportamento da API:

- **`db:reset:test` podia apagar o banco errado** se `DATABASE_URL` já
  estivesse exportada no shell (`dotenv run` não sobrescreve variáveis
  existentes por padrão) — provado pelo Qwen com um banco canário.
  Corrigido: reescrito como `scripts/db-reset-test.ts`, que monta o
  ambiente do processo filho com os valores de `.env.test` sempre por
  cima de qualquer coisa herdada, e recusa rodar se o nome do banco alvo
  não contiver `"test"`. Testado reproduzindo o mesmo cenário do canário.
- **Erros de integridade via SQL cru (`P2010`) ou via client sem P-code
  dedicado (`P2039`) caíam no `default` do filtro e viravam `500`** —
  acharia exatamente o `CHECK` que o Gate Fase 3 (abaixo) promete. Como o
  Qwen mediu isso criando temporariamente o `CHECK` real de
  `Job.filledCount`, adiantamos a correção no filtro (mapeamento por
  classe do SQLSTATE, incluindo os retryáveis de lock/deadlock/timeout
  que uma fila de `FOR UPDATE` pode produzir) — sem alterar a migration
  agora, só o `GlobalExceptionFilter`. Testado com o mesmo repro do Qwen.

## Adendo rodada 8 — REPROVADO → corrigido (Fase 3: Domínio, Companies + Jobs)

Primeira auditoria sobre código de domínio de negócio (não mais só
Auth/RBAC). **REPROVADO** com 3 críticos, todos corrigidos e
reverificados por execução — inclusive contra o servidor de dev,
reproduzindo o ataque exato do relatório. Ver
`PARECER-QWEN-FASE3-DOMINIO-RODADA8.md` e `TRIAGEM-REVISOES-RODADA8.md`
para o relato completo.

- **C1 — regra obrigatória "recruiter só opera vagas da própria empresa"
  quebrada de ponta a ponta.** `companyId: null` era tratado como acesso
  global em duas das três funções de escopo de `JobsService`, e o
  RECRUITER do seed nascia sem `companyId` (senha pública). Corrigido:
  função única `hasJobScope()` usada em todo lugar; seed vincula o
  RECRUITER a uma empresa; teste com o usuário real do seed (não
  fabricado).
- **C2 — corrida check-then-write sobrescrevia estado terminal da vaga**
  (`CANCELED` virava `PAUSED` em 52% de 25 corridas medidas). Corrigido
  com o mesmo primitivo do `refresh()` da Fase 2: `updateMany`
  condicionado ao estado lido, `409` se outra transição já mudou o
  status.
- **C3 — empresa desativada não impedia seus recrutadores de continuar
  criando/editando/publicando vagas**, que apareciam na vitrine pública
  mesmo com `GET /companies/:id` respondendo `404`. Corrigido: `isActive`
  da empresa checado em toda escrita de vaga (create/update/updateStatus);
  leitura de vagas já `OPEN` não é afetada retroativamente (decisão
  explícita, registrada).

Também corrigido no contrato de erro (ressalva, não crítico): `403`
ganhou `reason: "permission_denied"`; `company_already_inactive`/
`company_already_active` migraram de `404` para `409` (o recurso existe,
o conflito é de estado); os dois formatos de `409` (com/sem campo
`error`) foram unificados.

Ressalvas fechadas na mesma rodada (baratas, resolvidas junto): R1
(`GET /jobs*` agora inclui `company: {id, name}`), R3 (`search` escapa
curingas de `LIKE`), R4 (`OPEN→CLOSED` reincluído na máquina de estados,
alinhando com o comentário do enum no schema), R5 (vitrine pública não
expõe mais `createdById`/`filledCount`).

**Adiado, registrado:** R2 (listagem pública sem JWT vs. detalhe exigindo
JWT — decisão de UX, não de segurança, antes da Fase 5);
`RECRUITER ⇒ companyId NOT NULL` como invariante de banco
(`FEEDBACKS-MELHORIA.md` #16 — recomendado antes do Gate Fase 3 abaixo).

## Adendo rodada 9 — APROVADO COM RESSALVAS (Fase 3 fechada: Companies + Jobs)

Reapresentação da Rodada 8 (que reprovou com 3 críticos). **Os três
fecharam sob carga maior** (96+ execuções concorrentes, matriz completa
papel×empresa, 0 violações) — ver `PARECER-QWEN-FASE3-DOMINIO-RODADA9.md`
e `TRIAGEM-REVISOES-RODADA9.md`.

Dois achados novos corrigidos nesta rodada:
- **N2** — o teste que provava a correção do C2 (rodada 8) tinha uma
  asserção falsa como invariante ("exatamente uma responde 200"), falha
  em ~5% das execuções num resultado legítimo. Reescrito para o
  invariante real (estado terminal nunca desfeito), rodado 10× por
  execução, confirmado 8 execuções seguidas sem falha.
- **Q3/N8** — vitrine pública anunciava vaga de empresa desativada que
  `GET /companies/:id` já dizia não existir. Corrigido filtrando
  **visibilidade pública** por `company.isActive` (sem cascatear o
  status da vaga — o dono continua lendo o próprio histórico).

**Registrado, sem bloquear o avanço:**
- **N1 (Gate Nível B):** `hasJobScope()` decide acesso global de ADMIN
  por `roleName === 'ADMIN'` (string sem proteção no banco) — não
  alcançável pela API hoje, vira gate do Nível B (ver seção abaixo).
- **Antes de `Application`:** decisão sobre candidatura em vaga de
  empresa desativada (preliminar: não aceitar); `GET /jobs/:id` (vaga
  `OPEN`) ainda expõe `createdById`/`filledCount` pra quem não tem
  `job:read:any` (R5 parcial); N9 (rate limiting) e N15 (pool do `pg`)
  reforçados — `GET /jobs` público agora faz `LIKE` + `count` + join de
  company por página.

## Adendo rodada 10 — REPROVADO → corrigido (Fase 3: CandidateProfile)

Primeira auditoria do módulo `CandidateProfile`. **REPROVADO** com 2
críticos de **vazamento real de PII** (telefone/endereço de candidato),
ambos corrigidos e reverificados por execução, inclusive contra o
servidor de dev — ver
`PARECER-QWEN-FASE3-CANDIDATEPROFILE-RODADA10.md` e
`TRIAGEM-REVISOES-RODADA10.md`.

- **C1 — recrutador de empresa DESATIVADA continuava lendo perfil
  completo.** Era a metade de LEITURA do C3 (rodada 8), que só corrigiu
  a metade de ESCRITA em `Jobs`. Corrigido: `getByUserId()` agora checa
  `company.isActive` do chamador antes de consultar `Application`.
- **C2 — `REJECTED`/`WITHDRAWN` destravavam o perfil completo**, com o
  caso mais grave sendo `WITHDRAWN`: o candidato desistir da candidatura
  aumentava a própria exposição de dados. Corrigido: predicado trocado
  de negação (`status !== PENDING`) para lista positiva
  (`STATUSES_THAT_UNLOCK_FULL_PROFILE`).

Também corrigido na mesma rodada: `409` espúrio em `PATCH /candidates/me`
concorrente (upsert retenta como `update` em vez de propagar o
conflito); falha de CEP em `UPDATE` deixava de apagar endereço já salvo
(`isResolvedAddress()`, corrigido também em `CompaniesService.update()`,
mesmo bug); `skills[]` ganhou `@MaxLength` por item; suíte deixou de
depender do ViaCEP estar no ar pra não ser flaky; teste de escopo
cross-tenant adicionado.

**Registrado, sem bloquear:** perfil de usuário desativado continua
legível (decisão consciente — histórico de processos em andamento não
deve sumir); a checagem de escopo (`companyId`/ADMIN) está duplicada
entre `Jobs` e `CandidateProfile` — extrair helper compartilhado quando
`Application` precisar da mesma lógica; corpo do `413` fora do padrão do
projeto (registrado em `FEEDBACKS-MELHORIA.md`).

## Adendo rodada 11 — APROVADO COM RESSALVAS (Fase 3 fechada: CandidateProfile)

Reapresentação da Rodada 10 (que reprovou com 2 críticos de PII). **Os
dois fecharam sob ataque mais amplo** que o nosso próprio (matriz
completa dos 7 status, sequências de transição, candidaturas mistas,
ciclo desativar→reativar, comparação byte-a-byte dos 6 corpos de `404`)
— ver `PARECER-QWEN-FASE3-CANDIDATEPROFILE-RODADA11.md` e
`TRIAGEM-REVISOES-RODADA11.md`.

Um achado **novo**, consequência direta da correção da ressalva 1 da
rodada 10 — e que o próprio Qwen registrou como falha de auditoria dele
mesmo, não só nossa (mediu `CEP inexistente → 201` na rodada 8 e marcou
como ✅ sem confrontar com o contrato que o `PARECER-DEEPSEEK-FASE1.md`
§5 já especificava desde a Fase 1):

- **N1 — CEP inválido e falha de rede eram tratados da mesma forma**,
  permitindo salvar um `cep` novo com o `street/city/state` do endereço
  ANTIGO (par CEP×endereço inconsistente). Corrigido implementando o
  contrato discriminado que o §5 sempre especificou:
  `CepService.resolve()` agora devolve `status: 'ok'|'invalid'|
  'unavailable'` — `invalid` (o provedor confirma que o CEP não existe)
  rejeita a operação inteira com `400 cep_nao_encontrado`; `unavailable`
  (falha de rede/timeout) preserva o endereço anterior e sinaliza um
  `addressWarning` na resposta, nunca bloqueia. Aplicado em
  `CompaniesService` e `CandidateProfileService` (mesmo bug nos dois,
  apontado pelo Qwen).

Três ressalvas de custo baixo também fechadas nesta rodada:
- **`isAdmin()` duplicada verbatim** em `JobsService` e
  `CandidateProfileService` — extraída pra `src/common/utils/role.util.ts`.
- **`db:reset:test` quebrava em clone fresco** (`ERR_MODULE_NOT_FOUND` no
  seed, que importa o client gerado) — `prisma generate` adicionado como
  primeiro passo do script. Reproduzido o erro exato (apagando
  `src/generated/prisma/` e rodando só o seed) antes de confirmar que a
  correção resolve.
- **README §5 descrevia o perfil reduzido como "candidatura `PENDING`"**
  — desatualizado desde o C2 da rodada 10 (`REJECTED`/`WITHDRAWN` também
  reduzem). Corrigido para descrever a lista positiva.

**Registrado, sem bloquear (decisão do próprio Qwen sobre extrair
agora):** a checagem de "empresa operável" (`company.isActive`) segue
duplicada entre `JobsService` e `CandidateProfileService` — mas com
`reason`s de 404 **intencionalmente diferentes** por módulo (anti-
enumeração: unificar cegamente vazaria `company_not_found` na rota de
perfis). Extrair só o **predicado** (não o lançamento do erro) quando
`Application` existir, terceiro consumidor da mesma pergunta.

## Adendo Fase 4 — Application, Interview, Document, Users, RBAC Nível B (implementado, SEM auditoria do Qwen ainda)

Últimas ~4h de produção do prazo acordado com o usuário. Implementado o
restante dos 41 endpoints do mapa do DeepSeek (`PARECER-DEEPSEEK-FASE2-ENDPOINTS.md`),
reaproveitando os padrões já validados nas 3 rodadas anteriores de
auditoria (escopo por empresa via `isAdmin()`/`isCompanyOperable()`
compartilhados, `updateMany` condicionado pro estado lido em toda escrita
concorrente, 404 anti-enumeração, `reason` estruturado, lista positiva em
vez de negação pra qualquer decisão de visibilidade condicional). **Sem
rodada de auditoria adversarial do Qwen** — diferente de Companies/Jobs/
CandidateProfile, este trabalho não passou pelo ciclo reprovar→corrigir→
reaprovar. Registrado como pendência explícita, não "fechado".

- **`Application`** — regra obrigatória de duplicidade
  (`@@unique([candidateId, jobId])`) e vaga inativa (`job.status !== OPEN`
  ou empresa desativada → mesma regra de visibilidade de `Jobs.findOne`).
  Máquina de estados `PENDING→UNDER_REVIEW→INTERVIEW→OFFERED→HIRED`,
  `REJECTED` a partir de qualquer estado não-terminal, `WITHDRAWN` só via
  rota dedicada (nunca destino de `PATCH .../status`). `HIRED` incrementa
  `Job.filledCount` dentro de uma transação com o mesmo primitivo
  condicional já provado em Jobs/Auth (`UPDATE ... WHERE filledCount <
  vacancies`) — testado com duas contratações simultâneas na última vaga
  (`Promise.all`), exatamente uma vence, nunca `5xx`. `GET /applications/:id`
  reaproveita a mesma lista positiva de status "com visibilidade completa"
  já usada em `CandidateProfile` (evita reintroduzir o bug da rodada 10,
  C2, numa terceira leitura condicional). `resumeDocumentId` validado
  contra IDOR (`ownerId === candidateId`, pendência que já estava
  registrada desde a Fase 1).
- **`Interview`** — contrato de `RESCHEDULED` (DeepSeek §5): cria uma NOVA
  entrevista em vez de editar a original, `201` com a nova, original vira
  `RESCHEDULED`. Só `SCHEDULED` tem saída; as outras 4 são terminais
  (decisão adotada: `409`, não permite corrigir feedback depois —
  decisão em aberto que o mapa do DeepSeek deixou registrada).
- **`Document`** — upload real (multer, `diskStorage`, MIME whitelist +
  limite de 5MB), fecha o cenário obrigatório #8. Achado corrigido no
  caminho: o `FileInterceptor` do Nest já traduz
  `MulterError('LIMIT_FILE_SIZE')` pra `PayloadTooLargeException`
  (`413`) antes de chegar ao filtro — reclassificado no
  `GlobalExceptionFilter` pra `400 arquivo_excede_tamanho_maximo` (o
  enunciado deste módulo pede `400`). Fecha parcialmente
  `FEEDBACKS-MELHORIA.md` #17 (só o caminho de upload; o caso original —
  JSON grande demais — segue em aberto).
- **`Users` (rotas novas)** — `GET /users`, `GET /users/:id`,
  `PATCH /:id/company`, `PATCH /:id/role`. Usam o formato de erro
  estruturado (diferente de `deactivate`/`reactivate`, que mantêm o
  formato antigo por serem rotas já auditadas — decisão preservada).
  `PATCH /:id/role` reusa a trava de "último ADMIN ativo" (mesmo espírito
  do achado da rodada 5) e adiciona uma nova invariante (RECRUITER com
  vaga ainda em andamento não pode trocar de papel sem reatribuir/encerrar
  antes). **Efeito colateral do DeepSeek não implementado:** mudar a
  empresa de um RECRUITER deveria reatribuir entrevistas futuras dele —
  registrado, não implementado (baixo risco, sem teste que dependa disso
  hoje).
- **RBAC Nível B** — `GET /roles`, `GET /roles/:id`,
  `PUT /roles/:id/permissions` (substituição completa do conjunto,
  `permissionIds` numéricos — o schema usa `Permission.id: Int`, não a
  `key` string que o mapa do DeepSeek sugeria). `DELETE /roles/:id`
  deliberadamente não exposto (mesma lógica de `job:delete` reservado).
  Trava mínima viável: bloqueia com `409` qualquer mudança que deixaria o
  sistema **sem nenhum papel** com `role:manage` (ninguém, nem um futuro
  ADMIN, conseguiria mais desfazer o erro) — testada como unidade
  (`src/roles/roles.service.spec.ts`), não e2e, pra não arriscar mexer no
  papel ADMIN real durante a suíte. Efeito imediato sem novo login,
  provado por e2e (`test/roles.e2e-spec.ts`): permissão concedida a um
  papel custom já vale na próxima requisição de quem tem esse papel,
  revogá-la também.
  **Registrado, não implementado:** revogação de `RolePermission` é
  destrutiva (`deleteMany`+`createMany`), não soft-delete com autor —
  exigiria migration nova, fora do orçamento de tempo desta rodada.
  `isSystem` não precisou de proteção de código nova porque este módulo
  nunca expõe rename/delete de `Role` (só leitura + substituição de
  permissões).

**Verificação:** build limpo · lint 0 avisos · `npm test` 6/6 ·
`npm run test:e2e` 131/131 (**137 no total**), rodado repetidas vezes
sem falha (uma falha isolada observada 1x em ~10 execuções, consistente
com o perfil de flakiness já conhecido do ViaCEP real usado sem mock nos
specs de Companies/CandidateProfile — não reproduzida nas execuções
seguintes).

**Próximo passo recomendado:** enviar este bloco inteiro pro Qwen como
Rodada 12 antes de considerar a Fase 4 fechada — o padrão de auditoria
adversarial das 3 rodadas anteriores encontrou críticos reais em módulos
que pareciam corretos na primeira implementação (C1 de Jobs, C1/C2 de
CandidateProfile); não há razão pra achar que `Application` (que soma
concorrência real + PII + múltiplos papéis, os três ingredientes que
causaram os críticos anteriores) esteja isento do mesmo risco.

## Adendo Rodada 12 — Fase 4 REPROVADA → corrigida (primeira auditoria real)

A previsão registrada no Adendo Fase 4 ("não há razão pra achar que
Application esteja isento do mesmo risco") se confirmou: **REPROVADO**
com 6 críticos, todos reproduzidos por execução real — ver
`PARECER-QWEN-FASE4-RODADA12.md` e `TRIAGEM-REVISOES-RODADA12.md`.

- **K1** — `HIRED` × redução de `vacancies` produzia `filledCount >
  vacancies` em 60% de 25 corridas (comparação contra um valor lido antes
  da transação, não a coluna). Corrigido com SQL parametrizado
  (coluna×coluna) **e** `CHECK` novo na migration
  (`job_filledcount_within_vacancies`) — o item do Gate Fase 3 que
  estava pendente desde a Fase 1.
- **K2/K3** — as travas de "último papel com `role:manage`" e "último
  ADMIN ativo" (esta reaproveitada em `updateRole`) tinham a MESMA
  vulnerabilidade: contagem e escrita em passos separados, sem
  transação — furadas em 83% das corridas nos dois casos. Corrigidas com
  o mesmo invólucro `$transaction(..., {isolationLevel: 'Serializable'})`
  que `deactivate()` já usa desde a rodada 6.
- **K4** — `PATCH /users/:id/company` com corpo `{}` derrubava a rota com
  `500` (`undefined` tratado como `null`). Corrigido distinguindo os
  dois no Service.
- **K5** — `isCompanyOperable()` (extraído na rodada 11) nunca chegou a
  Applications/Interviews/Documents — recrutador de empresa desativada
  continuava com acesso total, incluindo **download de arquivo real**.
  Corrigido nos 3 módulos.
- **K6** — escopo de `Document` liberava TODOS os documentos de um
  candidato com candidatura qualificada, não só os anexados — um laudo
  médico nunca enviado à empresa era acessível do mesmo jeito. Corrigido
  removendo a branch ampla demais.

**Mudança de infraestrutura:** `vitest.config.e2e.ts` ganhou
`fileParallelism: false` — necessário pra provar K3 sem risco de
interferência cruzada com `auth.e2e-spec.ts` (que já mexe na contagem
global de admins ativos). Custo: suíte e2e de ~13s pra ~35s, aceitável.

**Registrado, não corrigido nesta rodada** (11 ressalvas do Qwen,
nenhuma bloqueante): validação de `interviewerId`/`scheduledAt` futuro em
Interview, campos de Interview inalcançáveis pela API
(`location`/`meetingLink`/`durationMinutes`/`isRemote`), guardas de
`isActive`/vagas ativas em `updateCompany`, mojibake em `originalName` de
Document, MIME confiando no cliente, ciclo de vida do arquivo físico
órfão, corpo do `500` sem `error`. Todas com destino registrado em
`TRIAGEM-REVISOES-RODADA12.md`.

**Verificação:** build limpo · lint 0 avisos · `npm test` 6/6 ·
`npm run test:e2e` 139/139 (**145 no total**), 3× seguidas sem falha,
incluindo reprodução real de concorrência pros 3 críticos de corrida
(K1/K2/K3) — invariante no banco verificado depois de cada rodada, nunca
"exatamente um 200".

## Adendo Rodada 13 — Fase 4 fechada: APROVADO COM RESSALVAS

Reapresentação da Rodada 12 (6 críticos). **Os seis fecharam sob carga
maior que a que os encontrou** (K1 15/25→0/45, K2/K3 10/12→0/20 cada, K5
4 rotas vazando→9/9 bloqueadas, K6 confirmado restrito à regra certa) —
ver `PARECER-QWEN-FASE4-RODADA13.md` e `TRIAGEM-REVISOES-RODADA13.md`.

3 condições de fechamento corrigidas nesta rodada, todas de contrato/
documentação (nenhuma de segurança):
- **`reason` no 409 de conflito de serialização** — precisou de 3
  correções, não 1: o duck-typing de `TransactionWriteConflict`, o case
  `P2034`/`P2028`, e o fallback por SQLSTATE do `GlobalExceptionFilter`
  são 3 caminhos DIFERENTES que produzem o mesmo 409 sob carga real, e a
  primeira tentativa só cobriu o primeiro — pego rodando a suíte 5×
  seguidas (2 execuções expuseram o `reason` ausente nos outros 2
  caminhos).
- **Mapa do DeepSeek atualizado** com adendo (texto original preservado)
  registrando que o escopo de `Document` é só `resumeDocumentId`, não
  `ownerId` — e o efeito colateral aceito (só `RESUME` é anexável hoje).
- **409 benigno de `PUT /roles/:id/permissions`** documentado no README.

**Registrado, não corrigido** (antes da Fase 5, sem crítica nova): modelo
de anexos explícito pra liberar `COVER_LETTER`/`CERTIFICATE`/`OTHER` a
recrutador (`FEEDBACKS-MELHORIA.md`); `updateCompany` sem checar
`isActive` da empresa; ciclo de vida do arquivo físico órfão.

**Verificação:** build limpo · lint 0 avisos · `npm test` 6/6 ·
`npm run test:e2e` 139/139 (**145 no total**), 5× seguidas sem falha.

## Passo 1 — antes do primeiro Guard/seed

- [x] **CE-1 decidido**: consumidor sempre confiável, API key global sem
      rotas isentas (ver seção "Decisão CE-1" abaixo). **Implementado** —
      `src/common/guards/api-key.guard.ts`, registrado como `APP_GUARD` em
      `src/app.module.ts`, testado (sem key → 401, key errada → 401, key
      certa → passa).
- [x] **CE-2**: catálogo de permissões como módulo de código compartilhado.
      **Feito** — `src/common/constants/permissions.constants.ts` (fonte
      única usada por `prisma/seed.ts` e por `@Permissions()`/
      `PermissionsGuard`). Correção em relação ao parecer do DeepSeek: ADMIN
      recebe 24 keys, não 28 (28 menos as 4 exclusivas de candidato) — a
      soma "todas as 28" do parecer original era inconsistente com a
      própria lista de exceções que ele deu. Confirmado no banco:
      ADMIN=24, RECRUITER=13, CANDIDATE=8 (total 45 `RolePermission`).
- [x] `package.json`, `tsconfig.json`, `prisma.config.ts`, `.env.example`
      versionados. **Feito** — scaffolding Nest 12 (ESM, Vitest) +
      `prisma.config.ts` + migration inicial aplicada em Postgres 18 local
      (`recrutamento_dev`/`recrutamento_test`, usuário dedicado
      `recrutamento_app`, não o superusuário).
- [x] `generator client` no `schema.prisma` com `moduleFormat` e
      `importFileExtension` explícitos (evita `ERR_UNKNOWN_FILE_EXTENSION`
      dependendo do `tsconfig` do ambiente — achado real da rodada 3).
      **Feito** — `moduleFormat = "esm"`, `importFileExtension = "js"`.
- [x] `omit` global no `PrismaService`/`PrismaClient` cobrindo `password`,
      `tokenHash`, `path` (mitigação de C3). **Feito** —
      `src/prisma/prisma.service.ts`.
- [x] Regra de negócio escrita e implementada: **nenhum endpoint de delete
      físico de `User`** — só `isActive = false`. **Feito** —
      `UsersService.deactivate()` (`src/users/users.service.ts`); nenhum
      controller expõe delete físico de usuário (o módulo de gestão de
      usuários com o endpoint ainda não existe, mas o método de serviço já
      segue a regra desde já).
- [x] Desativação de usuário (`isActive = false`) **revoga todos os
      `RefreshToken` ativos**; fluxo de refresh revalida `isActive`. 🔄
      **rodada 4 — corrigido de verdade**: a auditoria Qwen (C5) provou que
      `deactivate()` não tinha nenhum chamador (não existia controller de
      usuários), então a alegação de "testado" na versão anterior deste
      item não se sustentava. Criado `UsersController` (`PATCH
      /users/:id/deactivate`, protegido por `user:manage`). Agora
      **testado de ponta a ponta de verdade**: admin desativa → `204` →
      `isActive=false` e refresh tokens revogados no banco → login do
      usuário desativado → `401`.
- [x] `resumeDocument.ownerId === candidateId` validado no Service antes de
      aceitar uma candidatura (não é enforçável só por FK). **Feito na
      Fase 4** — `ApplicationsService.assertOwnDocumentOrThrow()`, `400
      resume_document_invalido` se o documento não existir ou não for do
      candidato que está se candidatando.
- [x] Regra de negócio escrita: `RESCHEDULED` sempre tem `rescheduledTo`
      preenchido; `CANCELED` nunca tem. **Satisfeito por construção na
      Fase 4** — `InterviewsService.reschedule()` só marca a entrevista
      original como `RESCHEDULED` na MESMA transação em que cria a nova
      com `previousInterviewId` apontando pra ela (`rescheduledTo` é a
      relação reversa disso); nenhum outro caminho do código seta
      `status: RESCHEDULED`, e nenhum caminho de `CANCELED` toca
      `previousInterviewId`.
- [x] Checagem no Service: não é possível criar `Interview` para
      `Application` com `status = WITHDRAWN`. **Feito na Fase 4** (mais
      restritivo que o pedido): `InterviewsService.create()` exige
      `status === INTERVIEW` exatamente, rejeitando `WITHDRAWN` e
      qualquer outro status com `409 application_not_in_interview_stage`.
- [x] DTOs com `@MaxLength` em campos de texto, especialmente `password`
      (bcrypt trunca em 72 bytes silenciosamente) e `name`. **Feito, com
      correção**: a primeira versão usava `@MaxLength(72)` na senha —
      contando *caracteres*, não *bytes*, o que não resolvia o problema
      para senhas com acentuação (comum em português: cada caractere
      acentuado usa 2 bytes em UTF-8, então 72 caracteres acentuados podem
      passar de 72 bytes). Corrigido eliminando o limite pela raiz:
      `src/common/utils/password.util.ts` pré-hasheia a senha com SHA-256
      antes do bcrypt, removendo o truncamento por completo — o `@MaxLength`
      no DTO virou só um teto de sanidade (256), sem relação com o bcrypt.
      Provado com senha de 80+ caracteres acentuados: login com a senha
      completa → `200`; login só com o prefixo (~72 bytes) → `401`.
- [x] Email normalizado (lowercase + trim) antes de checar unicidade/login.
      **Feito** — `normalizeEmail()` em `src/users/users.service.ts`,
      usado tanto no cadastro quanto no login.
- [x] Tabela de casos de teste para a política de precedência
      401→401→403→404→409 (API key, JWT, permissão, dono do recurso, regra
      de negócio). 🔄 **rodada 4**: formalizado como suíte automatizada
      (`test/auth.e2e-spec.ts`) — 401 sem API key, 401 sem JWT, 403 sem
      permission key, 404 de recurso inexistente, 409 de email duplicado
      (inclusive sob concorrência real). `WWW-Authenticate` no `401` ainda
      **não** adicionado — fica como pendência menor (R do Qwen rodada 4,
      "custo de uma linha").
- [x] Guard de autorização funciona de ponta a ponta. 🔄 **rodada 4** (item
      novo, não existia nesta lista): a auditoria provou que
      `PermissionsGuard` rodava antes do `JwtAuthGuard` (guards globais
      sempre rodam antes de guards de controller/rota), então toda rota
      com `@Permissions()` retornaria `403` mesmo para quem tinha a
      permissão — nunca detectado porque nenhuma rota usava isso ainda.
      Corrigido: `JwtAuthGuard` também é global agora, na ordem
      `[ApiKeyGuard, JwtAuthGuard, PermissionsGuard]`, com `@Public()`
      isentando as rotas de auth. Provado com `PATCH /users/:id/deactivate`.
- [x] Validação de ambiente no boot. 🔄 **rodada 4** (item novo): a
      auditoria forjou um JWT válido usando o `JWT_SECRET` literal do
      `.env.example` e autenticou como qualquer usuário — bypass total de
      autenticação em qualquer deploy que esquecesse de trocar os
      segredos. Corrigido: `src/config/env.validation.ts` (Joi) recusa o
      boot se `JWT_SECRET`/`API_KEY` forem os placeholders do `.env.example`
      ou iguais entre si. Provado: boot com o placeholder → crash
      controlado, antes de qualquer rota existir.

## Gate Fase 3 (concorrência)

- [ ] `CHECK (filledCount <= vacancies)` e `CHECK (filledCount >= 0)`
      adicionados via SQL na migration, **com verificação de que sobrevivem**
      a um `migrate dev` posterior (não é modelado pelo Prisma, pode ser
      derrubado em silêncio por uma migration futura que recrie a tabela).
- [ ] Dentro do lock, a transação valida **as duas** invariantes:
      `filledCount <= vacancies` **e** `count(Application WHERE status =
      HIRED) <= vacancies` (o contador armazenado sozinho pega o sintoma,
      não a causa).
- [ ] `updatedAt DEFAULT now()` explícito via SQL na migration bruta (fecha
      a lacuna que só importa porque a Fase 3 escreve SQL à mão).
- [ ] Teste `Promise.all` com N requisições simultâneas, **contra PostgreSQL
      real** (banco embutido derruba conexão sob carga — já provado nas
      rodadas anteriores), assertando as duas invariantes acima.
- [ ] Qualquer `$queryRaw` usado no lock seleciona só as colunas
      estritamente necessárias — `omit` global não se aplica a SQL cru.
- [ ] Pool de conexão do driver `pg` configurado com timeout explícito
      (achado Qwen rodada 5, N15) — sem isso, o teste de concorrência com N
      requisições simultâneas esbarra no limite do pool antes de esbarrar
      no lock, e o sintoma vira um timeout confuso (`P2028`) em vez de
      contenção esperada.
- [ ] Índice de expressão (ou `citext`) para `User.email` case-insensitive
      no banco — hoje a normalização (`lowercase`+`trim`) só existe na
      aplicação; um `INSERT` via SQL bruto (que esta fase já prevê) pode
      criar `A@x.com` ao lado de `a@x.com` (achado Qwen rodada 4, R13).
- [x] Erros do Prisma (`P2002`, `P2003`, `P2034`, `P2028`) mapeados
      explicitamente para `409`/`400`/`404` no filtro global — nunca `500`.
      **Adiantado da rodada 4** (achado R1, "corrigir antes da Fase 5" virou
      "corrigido agora" porque já era alcançável em `POST /auth/register`
      sem nenhuma concorrência real de vaga). Provado com 5 registros
      simultâneos com o mesmo email: 1×`201`, 4×`409`, zero `500`.
      **Refinado na rodada 5** (N2/N3): `P2002` agora nomeia o campo real
      (lido de `meta.driverAdapterError.cause.constraint.index`, não de
      `meta.target`, que não existe no Prisma 7 com driver adapter);
      `P1xxx` (infraestrutura) vira `503`, não `409`; `default` vira `500`
      honesto — `409` fica restrito a conflito de dado real. **Consolidado
      na rodada 6** (N1-a): os dois filtros separados
      (`PrismaExceptionFilter`, `UnauthorizedExceptionFilter`) viraram um
      único `src/common/filters/global-exception.filter.ts`, que também
      reconhece o conflito de transação `Serializable` do driver adapter
      (`TransactionWriteConflict`, formato que `P2034` nunca captura na
      prática) e devolve `409` em vez de `500`.
- [x] **O `CHECK` (item acima) disparando produz `409`, não `500`** —
      item novo pedido pelo Qwen na rodada 7, **adiantado antes mesmo do
      `CHECK` existir na migration**: o `GlobalExceptionFilter` agora
      classifica qualquer erro de integridade por SQLSTATE
      (`meta.driverAdapterError.cause.originalCode`), cobrindo tanto o
      caminho via client (`P2039`) quanto via SQL cru (`P2010`, que serve
      de envelope genérico pra qualquer violação disparada fora do
      client) — `23505`/`23514` (unique/check) → `409`,
      `23503`/`23502` (FK/not-null) → `400`, mais os SQLSTATEs
      retryáveis de lock/deadlock/timeout (`40P01`/`55P03`/`57014`) → `409`,
      prováveis numa fila de `SELECT ... FOR UPDATE`. Testado criando
      temporariamente o `CHECK` de `Job.filledCount` via
      `$executeRawUnsafe` (sem tocar a migration), violando pelos dois
      caminhos, confirmando `409` nos dois, e removendo a constraint em
      seguida (zero resíduo em `pg_constraint`). **Falta ainda:** quando a
      Fase 3 adicionar o `CHECK` de verdade na migration, escrever o
      teste automatizado que o viola de propósito e assere `409`
      (sugestão 1 do Qwen, rodada 7) — hoje essa verificação só existe
      como evidência de auditoria, não como teste na suíte.

## Gate Nível B (só se/quando o endpoint de ADMIN editar permissões existir)

- [ ] Trava de "último administrador" (Service, mínimo viável).
- [ ] Revogação não-destrutiva de `RolePermission` (soft-delete com autor),
      resolvendo também a "aposentadoria" de uma `Permission` concedida por
      engano (hoje impossível de remover por causa do `Restrict`).
- [ ] Proibição de `DELETE` de `Role` via endpoint (hoje `Role →
      RolePermission` continua `Cascade` — aceitável só enquanto papéis só
      vêm do seed).
- [ ] `isSystem` efetivamente impede rename/exclusão dos 3 papéis do
      enunciado no Service (hoje o campo existe mas não protege nada
      sozinho).
- [ ] **N1 (Qwen, rodada 9):** `JobsService.hasJobScope()` decide acesso
      global de ADMIN comparando `roleName === 'ADMIN'` — uma string sem
      proteção no banco. Provado por execução: renomear o papel ADMIN e
      criar um novo papel chamado "ADMIN" com `companyId` de outra
      empresa dá acesso cruzado a esse impostor, e o ADMIN real (papel
      renomeado) perde acesso. Não alcançável pela API hoje (exige este
      próprio Gate Nível B), mas vira explorável no dia em que existir.
      Correção recomendada pelo Qwen: trocar a checagem de nome de papel
      por uma permission key dedicada (`job:write:any` ou equivalente),
      o mesmo mecanismo que `job:read:any` já usa — resolve
      estruturalmente em vez de proteger só o nome "ADMIN".

## Decisão CE-1 — resolvida

**O consumidor da API é sempre um cliente confiável** (Postman, Swagger UI,
curl, Thunder Client, ou o avaliador testando diretamente) — não existe
frontend/SPA no escopo desta avaliação. Consequência: a API key é exigida
**globalmente**, via `APP_GUARD` único, **sem lista de rotas isentas**,
inclusive em `/auth/login` e na listagem pública de vagas. O guard fica
simples, como já estava desenhado em `FASE-1-MODELAGEM.md` §5.1.

**Nota para o futuro (registrada, não decidida agora):** existe a
possibilidade de, como melhoria pós-obrigatório, adicionar um frontend para
apresentação do projeto. Se isso acontecer, a arquitetura de API key
**precisa ser revisitada** — um frontend rodando no navegador do usuário
(fetch direto, ou um app Angular) exporia a chave no bundle JS, quebrando a
premissa desta decisão. Duas saídas nesse cenário futuro: (a) o frontend
não chama a API de recrutamento diretamente, um backend-for-frontend (BFF)
guarda a API key no servidor e repassa as chamadas, ou (b) a API key deixa
de ser global e vira isenta nas rotas que esse frontend chamaria. Ver
`FEEDBACKS-MELHORIA.md` #10.
