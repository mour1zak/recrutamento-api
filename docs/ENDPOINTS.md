# Endpoints — Plataforma de Recrutamento API

Documentação completa de todas as rotas: o que cada uma faz, por que existe,
quem pode chamá-la e o que devolve. Todas as rotas exigem o header
`x-api-key` (camada adicional ao JWT, sem exceções — nem nas rotas públicas
de auth).

## Convenções do contrato

| Item | Convenção | Motivo |
|---|---|---|
| Erros | `{statusCode, error, message, reason?}` | `reason` é machine-readable — o frontend decide comportamento por código, não parseando texto |
| `404` anti-enumeração | Recurso fora do escopo responde igual a inexistente | Ninguém descobre IDs alheios varrendo a API |
| Sem `DELETE` físico | Soft-delete via `PATCH .../status` ou `.../deactivate` | Preserva histórico (candidaturas, entrevistas, auditoria) e é reversível |
| `PATCH` de dados vs. `PATCH` de status | Separados (`/jobs/:id` e `/jobs/:id/status`) | Editar campos é uma coisa; transitar a máquina de estados é outra |
| Operações pessoais | Sempre `/me`, nunca `:id` vindo do cliente | "Recursos de terceiros não podem ser manipulados alterando IDs" — a identidade vem do JWT |

---

## 1. Health

### `GET /health`
- **Auth:** só API key
- **Respostas:** `200 {status:"ok", timestamp}`
- **Por que existe:** healthcheck para Docker/load balancer/monitoramento.
  Exigir só a API key (não JWT) permite verificação por ferramentas de
  infra, sem usuário.

---

## 2. Auth — quem você é

### `POST /auth/register`
- **Auth:** só API key
- **Body:** `{name, email, password}`
- **Respostas:** `201` (tokens); `400` DTO inválido; `409` email duplicado
- **Por que existe:** entrada self-service. Registro **nunca** cria
  RECRUITER/ADMIN — quem controla os papéis é o ADMIN via
  `PATCH /users/:id/role` (evita escalonamento de privilégio).

### `POST /auth/login`
- **Auth:** só API key
- **Body:** `{email, password}`
- **Respostas:** `200` (par access + refresh); `401` credenciais inválidas
- **Por que existe:** troca credenciais por JWT. Access token expira rápido;
  refresh vive mais e renova sem novo login.

### `POST /auth/refresh`
- **Auth:** só API key
- **Body:** `{refreshToken}`
- **Respostas:** `200` (novo par); `401` token inválido/expirado/**já usado**
- **Por que existe:** **rotação de refresh token**. Cada uso invalida o
  anterior; um token reusado indica sessão roubada e é rejeitado.

### `POST /auth/logout`
- **Auth:** JWT
- **Body:** `{refreshToken}`
- **Respostas:** `204`; `401` sem JWT/inválido
- **Por que existe:** encerramento **real** de sessão no servidor (o token
  fica inválido), não só apagar do client. Requer JWT porque só o dono da
  sessão pode encerrá-la.

---

## 3. Companies — o tenant do sistema

### `POST /companies`
- **Auth:** JWT + `company:create`
- **Body:** `{name, cnpj?, description?, cep}`
- **Respostas:** `201`; `400` DTO/CEP; `409` CNPJ duplicado (`reason: "cnpj_duplicado"`)
- **Por que existe:** cria o "tenant". Recrutadores e vagas se penduram na
  empresa. O CEP é validado/enriquecido via integração externa (ViaCEP).

### `GET /companies/:id`
- **Auth:** JWT + `company:read`
- **Respostas:** `200`; `404` inexistente **ou inativa**
- **Por que existe:** empresa desativada responde `404` (não `200` com
  flag) — contrato simples pro frontend + anti-enumeração.

### `PATCH /companies/:id`
- **Auth:** JWT + `company:update`
- **Body:** `{name?, cnpj?, description?, cep?}`
- **Respostas:** `200`; `400` DTO; `404` inexistente/inativa

### `PATCH /companies/:id/deactivate`
- **Auth:** JWT + `company:delete`
- **Respostas:** `200` (`isActive: false`); `404`; `409` já inativa (`reason: "company_already_inactive"`)
- **Por que existe:** soft-delete. Deletar fisicamente destruiria vagas,
  candidaturas e histórico. Efeito colateral controlado: vagas da empresa
  somem da vitrine pública, mas **não** são canceladas (o reactivate
  conseguiria reverter).

### `PATCH /companies/:id/reactivate`
- **Auth:** JWT + `company:delete`
- **Respostas:** `200` (`isActive: true`); `404`; `409` já ativa (`reason: "company_already_active"`)
- **Por que existe:** toda ação destrutiva reversível precisa do caminho de
  volta. Idempotente.

---

## 4. Jobs — o produto central

### `GET /jobs`
- **Auth:** só API key (**rota pública — a vitrine**)
- **Query:** `?page&limit&search`
- **Respostas:** `200` lista paginada, só vagas `OPEN` de empresas ativas
- **Por que existe:** o candidato anônimo precisa ver vagas antes de criar
  conta. O `select` da vitrine **não** inclui `createdById` nem
  `filledCount` — dado interno não pertence a vitrine pública. Traz
  `company: {id, name}` embutida.

### `POST /jobs`
- **Auth:** JWT + `job:create`
- **Body:** `{title, description, vacancies, salaryMin?, salaryMax?, isRemote, companyId?}`
- **Respostas:** `201`; `400` DTO ou `companyId` ausente para ADMIN;
  `404` `companyId` de outra empresa/inexistente/inativa ou RECRUITER sem empresa
- **Por que existe:** RECRUITER cria na **própria** empresa (o `companyId`
  vem do token, do body é ignorado); ADMIN precisa informar. É a regra
  "recrutador só opera vagas da própria empresa" aplicada na criação.

### `GET /jobs/mine`
- **Auth:** JWT + `job:read:any`
- **Query:** `?status&page&limit`
- **Respostas:** `200` vagas da própria empresa em **qualquer status**
- **Por que existe:** painel do recrutador precisa ver rascunhos, pausadas
  e preenchidas — diferente da vitrine pública. ADMIN vê todas.

### `GET /jobs/:id`
- **Auth:** JWT + `job:read`
- **Respostas:** `200` se `OPEN` (e empresa ativa), ou `job:read:any` +
  mesma empresa; `404` caso contrário
- **Por que existe:** regra em duas camadas — público vê só o que está
  publicado; dono vê o próprio histórico.

### `PATCH /jobs/:id`
- **Auth:** JWT + `job:update`
- **Body:** `{title?, description?, vacancies?, salaryMin?, salaryMax?, isRemote?}`
- **Respostas:** `200`; `400` DTO; `404` fora do escopo; `409` `vacancies`
  abaixo do já preenchido (`reason: "vacancies_below_filled_count"`)
- **Por que existe:** não dá para "apagar" vagas já ocupadas editando o
  número — regra de conflito de negócio.

### `PATCH /jobs/:id/status`
- **Auth:** JWT + `job:status:update`
- **Body:** `{status}`
- **Respostas:** `200`; `400` transição inválida (`reason: "invalid_status_transition"`);
  `404` fora do escopo; `409` `FILLED` sem preencher todas as vagas (`reason: "job_not_fully_filled"`)
- **Por que existe:** a **máquina de estados** do domínio.
  Transições válidas: `DRAFT→{OPEN,CANCELED}`, `OPEN→{PAUSED,FILLED,CLOSED,CANCELED}`,
  `PAUSED→{OPEN,CANCELED}`, `FILLED→CLOSED`. `CLOSED`/`CANCELED` são terminais.
  `DELETE /jobs/:id` **deliberadamente não existe** — cancelar via status
  preserva candidaturas/entrevistas/documentos vinculados.

---

## 5. Candidates — perfil e privacidade

### `GET /candidates/me`
- **Auth:** JWT + `candidate-profile:read`
- **Respostas:** `200`; `404` perfil ainda não criado
- **Por que existe:** operação pessoal usa `@CurrentUser()`, nunca `:id`
  da URL — a identidade vem do token.

### `PATCH /candidates/me`
- **Auth:** JWT + `candidate-profile:update:own`
- **Body:** `{headline?, summary?, phone?, cep?, skills?}`
- **Respostas:** `200` (**upsert** — cria na primeira chamada); `400` DTO/CEP
- **Por que existe:** upsert proposital — elimina o `404` chato no primeiro
  acesso e a pergunta "existe perfil?" pro frontend. CEP passa pela mesma
  integração externa de Companies.

### `GET /candidates/:userId`
- **Auth:** JWT + `candidate-profile:read`
- **Respostas:** `200` completo ou reduzido; `404` nunca candidatou na
  empresa, empresa desativada ou fora do escopo
- **Por que existe (a rota mais sofisticada de privacidade):**
  - Dono e ADMIN → sempre **completo**
  - RECRUITER só enxerga se o candidato tiver candidatura em vaga da
    empresa dele — senão `404` (anti-enumeração)
  - Dentro disso: **completo** (`summary`/`phone`/endereço) se alguma
    candidatura saiu de `PENDING`; **reduzido** (`id`, `name`, `headline`,
    `skills`) se só `PENDING`/`REJECTED`/`WITHDRAWN`
  - Nunca `403` — o frontend trata dois casos, não três, e nada vaza sobre
    a existência do ID

---

## 6. Applications — o funil de candidatura

### `POST /jobs/:jobId/applications`
- **Auth:** JWT + `application:create`
- **Body:** `{coverLetter?, resumeDocumentId?}`
- **Respostas:** `201`; `400` DTO ou `resumeDocumentId` não pertence a você;
  `404` vaga inexistente ou empresa inativa; `409` candidatura duplicada
  (`reason: "candidatura_duplicada"`) ou vaga não `OPEN` (`reason: "job_not_open"`)
- **Por que existe:** aninhada sob `/jobs` porque candidatura sem vaga não
  existe. Implementa as duas regras obrigatórias do enunciato (duplicada
  proibida; vaga inativa não aceita).

### `GET /applications/me`
- **Auth:** JWT + `application:read:own`
- **Query:** `?status&page&limit`
- **Respostas:** `200` só as do `@CurrentUser()`
- **Por que existe:** o candidato nunca lista candidaturas de terceiros.

### `GET /jobs/:jobId/applications`
- **Auth:** JWT + `application:read:job`
- **Respostas:** `200`; `404` vaga de outra empresa
- **Por que existe:** visão do recrutador sobre uma vaga. Mesmo erro para
  "não existe" e "não é sua".

### `GET /applications/:id`
- **Auth:** JWT (sem `@Permissions()` — **OU** entre `read:own`/`read:job`/`read:any`, decidido no Service)
- **Respostas:** `200` completo ou reduzido; `403` nenhuma das 3 keys;
  `404` fora do escopo
- **Por que existe:** três perfis legítimos precisam ler o mesmo recurso
  por motivos diferentes — a permissão fixa do guard não serve, então a
  decisão desce para o service.

### `PATCH /applications/:id/status`
- **Auth:** JWT + `application:status:update`
- **Body:** `{status, reason?}`
- **Respostas:** `200`; `400` transição inválida; `404` fora do escopo;
  `409` `HIRED` sem vaga (`reason: "no_vacancies_left"`) ou mudança
  concorrente (`reason: "application_status_changed_concurrently"`)
- **Por que existe:** o recrutador move o funil
  (`PENDING→UNDER_REVIEW→INTERVIEW→OFFERED→HIRED` ou `REJECTED`). Cada
  transição grava `ApplicationStatusHistory` (quem, quando, de→para,
  motivo) — histórico auditável, não campo mutável. A contratação compete
  pela vaga: sob `Promise.all`, exatamente uma vence.

### `PATCH /applications/:id/withdraw`
- **Auth:** JWT + `application:withdraw:own`
- **Body:** `{reason?}`
- **Respostas:** `200`; `404` não é o dono; `409` status final
  (`reason: "application_ja_encerrada"`)
- **Por que existe:** permissão separada porque o **recrutador não pode
  desistir pelo candidato** — só o dono, e só antes do fim do funil.

---

## 7. Interviews — agendamento

### `POST /applications/:applicationId/interviews`
- **Auth:** JWT + `interview:create`
- **Body:** `{scheduledAt, interviewerId?}`
- **Respostas:** `201`; `400` DTO; `404` candidatura fora do escopo;
  `409` candidatura não está em `INTERVIEW` (`reason: "application_not_in_interview_stage"`)
- **Por que existe:** força o funil correto — não dá para agendar entrevista
  pulando etapas. Aninhada sob a candidatura.

### `GET /applications/:applicationId/interviews`
- **Auth:** JWT + `interview:read`
- **Respostas:** `200`; `404` fora do escopo

### `GET /interviews/:id`
- **Auth:** JWT + `interview:read`
- **Respostas:** `200`; `404` fora do escopo

### `PATCH /interviews/:id`
- **Auth:** JWT + `interview:update`
- **Body:** `{status?, feedback?, scheduledAt?}`
- **Respostas:** `200` (edição normal) ou **`201` com a NOVA entrevista**
  quando `status: "RESCHEDULED"`; `400` `scheduledAt` ausente no
  reagendamento; `404`; `409` status final
- **Por que existe:** reagendar **cria um novo registro** e marca o
  original como `RESCHEDULED` — histórico de agendamentos preservado.
  Por isso `201` e não `200`: um recurso novo nasceu.

---

## 8. Documents — upload com propósito real

### `POST /documents`
- **Auth:** JWT + `document:upload:own`
- **Body:** `multipart/form-data` — `file` + `type`
- **Respostas:** `201 {id, filename, mimeType, sizeBytes}`; `400` arquivo
  ausente (`reason: "arquivo_ausente"`), MIME fora da whitelist
  (`reason: "mime_type_invalido"`), tamanho &gt; 5MB
  (`reason: "arquivo_excede_tamanho_maximo"`)
- **Por que existe:** as três validações obrigatórias do enunciato
  (presença, tamanho, tipo). Conectado ao domínio: o documento vira
  `resumeDocumentId` da candidatura.

### `GET /documents/me`
- **Auth:** JWT + `document:read:own`
- **Respostas:** `200` lista os próprios

### `GET /documents/:id`
- **Auth:** JWT (sem `@Permissions()` — **OU** entre `read:own`/`read:application`)
- **Respostas:** `200` (stream/download); `403` nenhuma das 2 keys;
  `404` fora do escopo
- **Por que existe:** escopo condicional — dono sempre baixa; recrutador
  **só** se existir candidatura `UNDER_REVIEW`+ do dono para vaga da
  empresa dele. É o upload conectado à funcionalidade real: o recrutador
  não baixa currículo de qualquer um.

---

## 9. Users e Roles — administração (RBAC Nível B)

### `GET /users`
- **Auth:** JWT + `user:read`
- **Query:** `?role&companyId&isActive&page&limit`
- **Respostas:** `200` lista paginada
- **Por que existe:** gestão. **Nunca devolve `password`** — regra explícita.

### `GET /users/:id`
- **Auth:** JWT + `user:read`
- **Respostas:** `200` (sem `password`); `404`

### `PATCH /users/:id/deactivate`
- **Auth:** JWT + `user:manage`
- **Respostas:** `200` (`isActive: false`); `403`; `404`; `409` própria
  conta, último ADMIN ativo ou conflito de concorrência
- **Por que existe:** travas de segurança reais — não pode desativar a si
  mesmo nem o último admin (senão o sistema fica sem gestão). Desativar
  **revoga os refresh tokens**: a sessão morre na hora.

### `PATCH /users/:id/reactivate`
- **Auth:** JWT + `user:manage`
- **Respostas:** `200` (idempotente); `403`; `404`

### `PATCH /users/:id/company`
- **Auth:** JWT + `user:manage`
- **Body:** `{companyId: number|null}`
- **Respostas:** `200`; `404`; `409` alvo não é RECRUITER (`reason: "usuario_nao_e_recrutador"`)
- **Por que existe:** move recrutador entre empresas (ou tira da empresa).

### `PATCH /users/:id/role`
- **Auth:** JWT + `user:manage`
- **Body:** `{roleId}`
- **Respostas:** `200`; `404`; `409` RECRUITER com vagas ativas
  (`reason: "recrutador_com_vagas_ativas"`) ou removeria o último ADMIN
  (`reason: "last_active_admin"`)
- **Por que existe:** trava de integridade — recrutador com vagas ativas
  não pode sair do papel (as vagas ficariam órfãs).

### `GET /roles` / `GET /roles/:id`
- **Auth:** JWT + `role:manage`
- **Respostas:** `200` com `permissions[]` aninhadas; `404`

### `PUT /roles/:id/permissions`
- **Auth:** JWT + `role:manage`
- **Body:** `{permissionIds: number[]}`
- **Respostas:** `200` (substitui o conjunto inteiro, efeito imediato —
  permissões recalculadas do banco a cada request); `400` `permissionId`
  inexistente; `404`; `409` deixaria o sistema sem `role:manage`
  (`reason: "sem_papel_com_role_manage"`)
- **Por que existe:** **PUT e não PATCH** porque é substituição idempotente
  do conjunto. Efeito imediato sem novo login. A trava final impede o
  admin de trancar a si mesmo para fora do sistema.

---

## Padrões transversais (resumo do "por quê")

1. **`x-api-key` em tudo** — camada extra antes do JWT, recomendação do
   avaliador. Sem a chave, nem o register funciona.
2. **Dupla checagem de autorização** — o guard valida a *permissão* (tem
   `job:update`?); o service valida a *posse* (é da minha empresa?). Só
   ID na URL nunca basta.
3. **`200` com recurso atualizado** em ações de estado (não `204`) — o
   frontend confirma o novo estado sem um `GET` extra.
4. **`201` com o recurso criado** em todo `POST` — o frontend usa o corpo
   direto, sem buscar depois.
5. **Histórico preservado em toda transição** — `ApplicationStatusHistory`,
   entrevista reagendada vira novo registro, nada é sobrescrito.