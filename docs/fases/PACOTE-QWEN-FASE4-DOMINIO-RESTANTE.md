# Pacote para revisão — Qwen (QA Lead & DevSecOps) — Fase 4: Application, Interview, Document, Users, RBAC Nível B

Cole este documento inteiro na conversa com o Qwen.

---

Você é o **QA Lead / DevSecOps Specialist** do projeto `recrutamento-api`.
Já aprovou (com ressalvas) `Companies`+`Jobs` (Rodada 9) e
`CandidateProfile` (Rodada 11). Este pacote é diferente dos anteriores em
um ponto importante: **os 5 módulos abaixo foram implementados de uma vez
só, sob um orçamento de tempo apertado (últimas ~4h de produção), sem
passar pelo ciclo de auditoria adversarial antes desta submissão.** Isso é
a primeira vez que você vê este código — não é uma reapresentação.

## O que existe pra revisar

### 1. Application (`src/applications/`) — 6 rotas
`POST /jobs/:jobId/applications` · `GET /applications/me` ·
`GET /jobs/:jobId/applications` · `GET /applications/:id` ·
`PATCH /applications/:id/status` · `PATCH /applications/:id/withdraw`.

Regras obrigatórias do enunciado: candidatura duplicada proibida
(`@@unique([candidateId, jobId])`, erro do banco traduzido pra `409
candidatura_duplicada`); vaga inativa não aceita candidatura (`404` se
vaga/empresa não existe ou está inativa, `409 job_not_open` se existe mas
não está `OPEN`). Máquina de estados:
`PENDING→UNDER_REVIEW→INTERVIEW→OFFERED→HIRED`, `REJECTED` a partir de
qualquer estado não-terminal, `WITHDRAWN` só pela rota dedicada (nunca
destino de `PATCH .../status`). `HIRED` incrementa `Job.filledCount`
dentro de uma transação com escrita condicionada
(`UPDATE ... WHERE filledCount < vacancies`), mesmo primitivo já
aprovado em Jobs/Auth. `GET /applications/:id` usa lista positiva de
status pra decidir payload completo/reduzido (mesma forma de
`CandidateProfile`, não a negação que causou o C2 da rodada 10).
`resumeDocumentId` validado contra IDOR (`ownerId === candidateId`).

### 2. Interview (`src/interviews/`) — 4 rotas
`POST /applications/:applicationId/interviews` ·
`GET /applications/:applicationId/interviews` · `GET /interviews/:id` ·
`PATCH /interviews/:id`.

Só agenda se `application.status === INTERVIEW`. Contrato de
`RESCHEDULED` (DeepSeek §5): `PATCH` com esse status cria uma NOVA
entrevista (`previousInterviewId` apontando pra original) e marca a
original como `RESCHEDULED` — retorno `201` com a nova, não `200`. As
outras 4 saídas de `SCHEDULED` (`COMPLETED`/`CANCELED`/`NO_SHOW`/
`RESCHEDULED`) são terminais — qualquer `PATCH` numa entrevista já
terminal é `409`.

### 3. Document (`src/documents/`) — 3 rotas
`POST /documents` (multipart) · `GET /documents/me` ·
`GET /documents/:id`.

Fecha o cenário obrigatório #8 do enunciado. MIME whitelist (PDF/Word) e
limite de 5MB validados no `FileInterceptor`, antes do Service rodar.
Escopo de `GET /documents/:id`: dono, ADMIN, ou recrutador com
candidatura vinculada (`resumeDocumentId` OU `ownerId` do documento) em
status `UNDER_REVIEW`+ pra uma vaga da própria empresa — senão `404`.

### 4. Users, rotas novas (`users.controller.ts`/`users.service.ts`)
`GET /users` · `GET /users/:id` · `PATCH /:id/company` ·
`PATCH /:id/role`. Diferente de `deactivate`/`reactivate` (que mantêm o
formato de erro antigo, já auditado), estas 4 usam o formato estruturado
(`reason`). `PATCH /:id/role` bloqueia RECRUITER→outro papel se ele tiver
vaga em `DRAFT`/`OPEN`/`PAUSED`, e reusa a trava de "último ADMIN ativo"
se a troca tirar o papel ADMIN de alguém que é o único ativo.

### 5. RBAC Nível B (`src/roles/`) — 3 rotas
`GET /roles` · `GET /roles/:id` · `PUT /roles/:id/permissions`.

Substituição completa do conjunto de permissões de um papel
(`permissionIds` numéricos — o schema usa `Permission.id: Int`, adaptado
do `string[]` que seu mapa original sugeria). Sem `DELETE /roles/:id`
(mesma lógica de `job:delete` reservado). Trava: bloqueia com `409` (não
com `500` nem silenciosamente) qualquer mudança que deixaria o sistema
**sem nenhum papel** com `role:manage`.

## O que já testamos por execução

137 testes automatizados (6 unitários + 131 e2e), incluindo:
- `Application`: duplicidade, vaga não-`OPEN`, vaga de empresa
  desativada, escopo cross-tenant em `GET /jobs/:jobId/applications` e
  `GET/PATCH /applications/:id`, transição inválida, **duas requisições
  `HIRED` simultâneas na última vaga de uma vaga com 1 posição**
  (`Promise.all` — exatamente uma vence, `409 no_vacancies_left` na
  outra, nunca `5xx`, confirmado por leitura direta de `Job.filledCount`
  depois).
- `Interview`: candidatura fora de `INTERVIEW` bloqueia criação,
  `RESCHEDULED` devolve `201` com a nova entrevista e marca a original
  como terminal, `PATCH` numa entrevista terminal é `409`, escopo
  cross-tenant.
- `Document`: upload válido, arquivo ausente, MIME não permitido,
  arquivo acima do limite (413 do framework reclassificado pra `400`
  estruturado), escopo condicional por status da candidatura
  (`PENDING` não dá acesso, `UNDER_REVIEW`+ dá).
- `Users`: papel não é RECRUITER bloqueia `PATCH /:id/company`,
  RECRUITER com vaga ativa bloqueia `PATCH /:id/role`, remover o último
  ADMIN ativo bloqueia.
- `RBAC`: `permissionId` inexistente é `400`, substituição é de verdade
  (não soma com o conjunto anterior), e — o teste que mais nos importa —
  **efeito imediato sem novo login**: concedi uma permissão a um usuário
  já logado, ele passou a acessar a rota; revoguei, a próxima
  requisição dele (mesmo token) já foi recusada.

A trava "sem nenhum papel com `role:manage`" foi testada como **unidade**
(`src/roles/roles.service.spec.ts`, com `PrismaService` mockado), não
e2e — forçar esse estado de verdade exigiria tirar `role:manage` do
ADMIN real durante a suíte, o que arriscaria interferir nos outros
arquivos de teste rodando contra o mesmo banco.

## Pontos que gostaríamos que você atacasse especificamente

1. **Concorrência de `HIRED`** — testamos só o caso de 2 requisições
   simultâneas numa vaga de 1 posição. Vale testar com mais concorrência
   (N > 2) e/ou vacancies > 1 com N candidatos disputando as últimas
   posições?
2. **Escopo de `Document`** — a regra usa `OR: [{resumeDocumentId: id},
   {candidateId: ownerId}]`. Isso significa que um recrutador com
   QUALQUER candidatura qualificada do mesmo candidato consegue ler
   QUALQUER documento daquele candidato, mesmo um que nunca foi anexado
   a uma candidatura da empresa dele. É a leitura pretendida do mapa do
   DeepSeek, ou é ampla demais?
3. **RBAC Nível B** — a trava de "último papel com role:manage" foi
   pensada, mas só testada como unidade mockada. Existe algum jeito de
   contorná-la que a gente não cobriu (ex.: duas requisições `PUT`
   simultâneas em papéis diferentes, cada uma removendo `role:manage` de
   um papel diferente, ambas passando na checagem porque nenhuma viu a
   mudança da outra antes de escrever)?
4. **Padrão geral** — este código nunca foi atacado antes. Trate como se
   fosse a Rodada 8 de novo: isolamento entre empresas, corridas de
   concorrência, vazamento de PII são os três tipos de crítico que você
   já encontrou nos módulos anteriores — onde mais esse padrão se repete
   aqui?

## Verificação

`npm run build` limpo · `npm run lint` 0 avisos · `npm test` 6/6 ·
`npm run test:e2e` 131/131 (**137 no total**), rodado repetidas vezes
(uma falha isolada observada 1x em ~10 execuções, consistente com o
perfil de flakiness já conhecido do ViaCEP real usado sem mock em
Companies/CandidateProfile — não reproduzida nas execuções seguintes).

## O que eu preciso de volta

Mesmo formato de sempre — mas como esta é a primeira auditoria destes 5
módulos, esperamos achados reais, não só ressalvas. Trate com o mesmo
rigor da Rodada 8 (Companies+Jobs, que reprovou com 3 críticos na
primeira vez).
