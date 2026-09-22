# Parecer — DeepSeek (Estrategista de Negócio/Infra) — Fase 2: Mapa de Endpoints

> Registro da resposta recebida em resposta ao
> `PACOTE-DEEPSEEK-FASE2-ENDPOINTS.md`. Texto do DeepSeek reproduzido na
> íntegra (sem resumir/reescrever conteúdo técnico), só com formatação de
> cabeçalho ajustada ao padrão do projeto — o mapa define rotas,
> permission keys e regras de negócio que ainda serão implementadas, e
> qualquer perda de detalhe aqui vira retrabalho no Controller.

## 0. Confirmações e correções incorporadas

### 0.1 ADMIN = 24 keys

Confirmo a correção. As 4 keys excluídas (`application:create`,
`application:withdraw:own`, `candidate-profile:update:own`,
`document:upload:own`) são ações exclusivas do CANDIDATE. Soma
consistente: 24 + 13 + 8 = 45 grants.

**Rodapé (não bloqueante):** ADMIN tem `document:read:own` e
`document:read:application` no seed, mas nenhuma é efetiva (ADMIN não
tem documentos próprios nem `companyId`). Se auditoria documental por
ADMIN for requisito, criar `document:read:any` no futuro. Fica como
follow-up.

### 0.2 `PATCH /users/:id/deactivate` — regras atualizadas

Incorporo as duas regras novas:

- Não autodesativa → `409 Conflict` (com `reason: "cannot_deactivate_self"`).
- Não desativa o último ADMIN ativo → `409 Conflict` (com
  `reason: "last_active_admin"`).

**Sugestão adicional:** a mensagem de erro deve ser estruturada
(`{ statusCode: 409, reason: "cannot_deactivate_self" | "last_active_admin", message }`)
para facilitar o frontend. Se o padrão do projeto for `ConflictException`
puro, perderá o `reason` — decisão a registrar no README.

### 0.3 `/health`

Adiciono à seção de rotas já definidas. Sem JWT, sem permission key —
apenas API key.

## Convenções aplicadas a todas as rotas

- API Key obrigatória em toda rota (inclusive `/health`). Ausente/inválida → `401`.
- JWT obrigatório em rotas privadas. Ausente/inválido → `401`.
- Permission key ausente no papel → `403 Forbidden`.
- Recurso fora do escopo do usuário (mesmo com permission presente) → `404 Not Found` (política P4, Fase 1).
- Violação de regra de negócio → `409 Conflict`.
- DTO inválido → `400 Bad Request`.
- `key1` OU `key2` indica `@RequireAnyPermission(...)` no guard.
- `:id` / `:jobId` / `:applicationId` / `:userId` = UUID do recurso.

## 1. Empresas (`company:*`)

| Método | URL | Permission key | Body | Respostas |
|---|---|---|---|---|
| `POST` | `/companies` | `company:create` | `{ name, cnpj?, cep }` | `201` · `400` DTO inválido · `400` CEP inválido (cenário #2) · `409` CNPJ duplicado · `401`/`403` |
| `GET` | `/companies/:id` | `company:read` | – | `200` · `404` inexistente ou `isActive=false` · `401`/`403` |
| `PATCH` | `/companies/:id` | `company:update` | `{ name?, cnpj?, cep? }` | `200` · `400` DTO/CEP · `404` inexistente ou inativa · `401`/`403` |
| `PATCH` | `/companies/:id/deactivate` | `company:delete` | – | `200 { isActive: false }` · `404` inexistente ou já inativa · `401`/`403` |
| `PATCH` | `/companies/:id/reactivate` | `company:delete` | – | `200 { isActive: true }` · `404` inexistente ou já ativa · `401`/`403` |

Notas:
- Sem `DELETE` físico — auditoria preservada.
- Desativar empresa não cascateia para vagas/usuários — registrar no README.

## 2. Vagas (`job:*`)

| Método | URL | Permission key | Body | Respostas |
|---|---|---|---|---|
| `POST` | `/jobs` | `job:create` | `{ title, description, vacancies, salaryMin?, salaryMax?, isRemote, companyId? }` | `201` · `400` DTO · `404` se `companyId ≠ user.companyId` · `401`/`403` |
| `GET` | `/jobs` | nenhuma (público c/ API key) | – (query `?page&limit&search`) | `200` lista apenas `status=OPEN` · `401` (só API key) |
| `GET` | `/jobs/mine` | `job:read:any` | – (query `?status&page`) | `200` vagas da própria empresa em qualquer status · `404` se RECRUITER sem `companyId` · `401`/`403` |
| `GET` | `/jobs/:id` | `job:read` OU `job:read:any` (JWT opcional) | – | `200` se `OPEN` (público) · `200` se `job:read:any` e `job.companyId === user.companyId` · `404` caso contrário · `401`/`403` |
| `PATCH` | `/jobs/:id` | `job:update` | `{ title?, description?, vacancies?, salaryMin?, salaryMax?, isRemote? }` | `200` · `400` · `404` fora do escopo · `409` se `vacancies < filledCount` · `401`/`403` |
| `PATCH` | `/jobs/:id/status` | `job:status:update` | `{ status }` | `200` · `400` transição inválida · `404` fora do escopo · `409` se `FILLED` com `filledCount < vacancies` · `401`/`403` |
| `DELETE` | `/jobs/:id` | `job:delete` | – | Não expor (ver nota) |

**Decisão sobre `DELETE /jobs/:id`:** não expor rota. Soft-delete via
`PATCH /jobs/:id/status` com `{ status: "CANCELED" }`. A key `job:delete`
fica reservada/futura no catálogo. Justificativa: preserva histórico de
candidaturas/entrevistas/documentos.

## 3. Candidaturas (`application:*`)

| Método | URL | Permission key | Body | Respostas |
|---|---|---|---|---|
| `POST` | `/jobs/:jobId/applications` | `application:create` | `{ coverLetter?, resumeDocumentId }` | `201` · `400` DTO · `404` vaga inexistente · `409` duplicidade · `409` vaga não `OPEN` · `403` se não for CANDIDATE · `401` |
| `GET` | `/applications/me` | `application:read:own` | – (query `?status&page`) | `200` apenas as do `@CurrentUser()` · `401`/`403` |
| `GET` | `/jobs/:jobId/applications` | `application:read:job` | – (query `?status&page`) | `200` · `404` se `job.companyId !== user.companyId` · `401`/`403` |
| `GET` | `/applications/:id` | `application:read:own` OU `application:read:job` OU `application:read:any` | – | `200` payload condicional (nota) · `404` fora do escopo · `401`/`403` |
| `PATCH` | `/applications/:id/status` | `application:status:update` | `{ status, reason? }` | `200` · `400` transição inválida · `404` fora do escopo · `409` se `OFFERED → HIRED` e `filledCount + 1 > vacancies` · `401`/`403` |
| `PATCH` | `/applications/:id/withdraw` | `application:withdraw:own` | `{ reason? }` | `200` · `404` se `candidateId !== user.id` · `409` se status terminal (`HIRED`/`REJECTED`/`WITHDRAWN`) · `401`/`403` |

**Payload condicional de `GET /applications/:id`** (regra Fase 1, Pergunta 2):

| Quem | Status | Retorno |
|---|---|---|
| CANDIDATE dono | qualquer | Completo |
| RECRUITER da empresa | `PENDING` | Reduzido: `coverLetter`, `resumeDocumentId`, `name`, `headline`, `skills[]` — sem phone/summary/endereço/docs extras |
| RECRUITER da empresa | `≥ UNDER_REVIEW` | Completo + docs extras |
| ADMIN | qualquer | Completo |

## 4. Perfil de Candidato (`candidate-profile:*`)

| Método | URL | Permission key | Body | Respostas |
|---|---|---|---|---|
| `GET` | `/candidates/me` | `candidate-profile:read` | – | `200` · `404` se não existir · `401` |
| `GET` | `/candidates/:userId` | `candidate-profile:read` | – | `200` payload condicional · `404` fora do escopo · `401`/`403` |
| `PATCH` | `/candidates/me` | `candidate-profile:update:own` | `{ headline?, summary?, phone?, cep?, skills? }` | `200` · `400` DTO/CEP · `401`/`403` |

**Payload condicional de `GET /candidates/:userId`:**

| Quem | Condição | Retorno |
|---|---|---|
| Próprio candidato | – | Completo |
| RECRUITER | Application do candidato para vaga da empresa com status `≥ UNDER_REVIEW` | Completo |
| RECRUITER | Application com status = `PENDING` | Reduzido (`name`, `headline`, `skills[]`) |
| RECRUITER | Nenhuma candidatura vinculada | `404` |
| ADMIN | – | Completo |

## 5. Entrevistas (`interview:*`)

| Método | URL | Permission key | Body | Respostas |
|---|---|---|---|---|
| `POST` | `/applications/:applicationId/interviews` | `interview:create` | `{ scheduledAt, interviewerId? }` | `201` · `400` DTO · `404` fora do escopo · `409` se `application.status ≠ INTERVIEW` · `401`/`403` |
| `GET` | `/applications/:applicationId/interviews` | `interview:read` | – | `200` · `404` fora do escopo · `401`/`403` |
| `GET` | `/interviews/:id` | `interview:read` | – | `200` · `404` fora do escopo · `401`/`403` |
| `PATCH` | `/interviews/:id` | `interview:update` | `{ status?, feedback?, scheduledAt? }` | `200` · `400` transição inválida · `404` fora do escopo · `409` se entrevista terminal · `401`/`403` |

**Contrato de `RESCHEDULED`:** `PATCH` com
`{ status: "RESCHEDULED", scheduledAt }` cria nova `Interview` (status:
`SCHEDULED`, `previousInterviewId = :id`) e marca a original como
`RESCHEDULED`. Retorno: `201` com a nova entrevista.

## 6. Documentos (`document:*`)

| Método | URL | Permission key | Body | Respostas |
|---|---|---|---|---|
| `POST` | `/documents` | `document:upload:own` | `multipart/form-data`: `file` + `type` (`RESUME\|COVER_LETTER\|CERTIFICATE\|OTHER`) | `201 { id, filename, mimeType, sizeBytes }` · `400` MIME inválido · `400` tamanho excedido · `400` arquivo ausente · `401`/`403` |
| `GET` | `/documents/me` | `document:read:own` | – | `200` · `401`/`403` |
| `GET` | `/documents/:id` | `document:read:own` OU `document:read:application` | – | `200` (stream) · `404` fora do escopo (nota) · `401`/`403` |

**Escopo de `GET /documents/:id`:**
- `document:read:own` → só se `document.ownerId === user.id`.
- `document:read:application` → só se existe `Application` vinculada
  (`resumeDocumentId` ou `ownerId`) com `job.companyId === user.companyId`
  e `status ≥ UNDER_REVIEW`.
- Caso contrário → `404`.

> **Adendo — achado Qwen rodada 12/13 (K6), texto original acima
> preservado verbatim.** A implementação seguiu este texto ao pé da
> letra na Fase 4 e o Qwen reprovou (rodada 12): a branch `ownerId`
> permitia que QUALQUER candidatura qualificada do candidato liberasse
> TODOS os documentos dele, inclusive um nunca anexado a candidatura
> nenhuma (ex.: um laudo médico). **Decisão registrada (rodada 13):**
> a regra real e implementada é só `resumeDocumentId` — o documento
> precisa estar de fato ANEXADO à candidatura, não apenas pertencer ao
> mesmo candidato. Efeito colateral aceito conscientemente:
> `COVER_LETTER`/`CERTIFICATE`/`OTHER` nunca ficam visíveis a recrutador
> nenhum hoje, porque `Application` só tem um slot de anexo
> (`resumeDocumentId`) — um modelo de anexos explícito resolveria isso
> (registrado em `FEEDBACKS-MELHORIA.md`), fora do escopo desta fase.

## 7. Gestão de Usuários (`user:*`)

| Método | URL | Permission key | Body | Respostas |
|---|---|---|---|---|
| `GET` | `/users` | `user:read` | – (query `?role&companyId&isActive&page`) | `200` · `401`/`403` |
| `GET` | `/users/:id` | `user:read` | – | `200` (sem `password`/`tokenHash`) · `404` · `401`/`403` |
| `PATCH` | `/users/:id/deactivate` | `user:manage` | – | `200` · `404` · `409` já inativo · `409` se `:id === user.id` (`cannot_deactivate_self`) · `409` se for o último ADMIN ativo (`last_active_admin`) · `401`/`403` |
| `PATCH` | `/users/:id/reactivate` | `user:manage` | – | `200` · `404` · `409` já ativo · `401`/`403` |
| `PATCH` | `/users/:id/company` | `user:manage` | `{ companyId: string \| null }` | `200` · `404` usuário/empresa inexistente · `409` se não for RECRUITER · efeitos colaterais Fase 1 (reatribuir entrevistas futuras) · `401`/`403` |
| `PATCH` | `/users/:id/role` | `user:manage` | `{ roleId }` | `200` · `404` · `409` se mudança quebrar invariantes (ex.: RECRUITER → CANDIDATE com vagas ativas) · `401`/`403` |

**Ordem de checagem em `deactivate`** (importante para os testes):
1. Recurso existe? → senão `404`.
2. Já está inativo? → `409` (`already_inactive`).
3. É o próprio usuário? → `409` (`cannot_deactivate_self`).
4. É o último ADMIN ativo? → `409` (`last_active_admin`).
5. Senão → `200`.

## 8. RBAC Dinâmico (`role:manage`) — Nível B (só desenho)

| Método | URL | Permission key | Body | Respostas |
|---|---|---|---|---|
| `GET` | `/roles` | `role:manage` | – | `200` lista com `permissions[]` aninhadas · `401`/`403` |
| `GET` | `/roles/:id` | `role:manage` | – | `200` · `404` · `401`/`403` |
| `PUT` | `/roles/:id/permissions` | `role:manage` | `{ permissionIds: string[] }` | `200` substitui conjunto · `400` ID inválido · `404` role/permission inexistente · efeito colateral: incrementar `User.permissionsVersion` dos usuários do papel · `401`/`403` |

## 9. Rotas já definidas (fora do escopo desta etapa)

| Método | URL | Permission key | Notas |
|---|---|---|---|
| `GET` | `/health` | nenhuma (só API key) | Health check de processo |
| `POST` | `/auth/register` | nenhuma (só API key) | Cria CANDIDATE |
| `POST` | `/auth/login` | nenhuma (só API key) | Retorna `accessToken` + `refreshToken` |
| `POST` | `/auth/refresh` | nenhuma (só API key) | Rotaciona refresh token |
| `POST` | `/auth/logout` | JWT, sem key específica | Revoga refresh token |

## 10. Resumo quantitativo

| Recurso | Rotas |
|---|---|
| Companies | 5 |
| Jobs | 6 (excluindo `DELETE` recomendado a não expor) |
| Applications | 6 |
| Candidate Profile | 3 |
| Interviews | 4 |
| Documents | 3 |
| Users | 6 |
| RBAC | 3 |
| Auth + Health (já existentes) | 5 |
| **Total** | **41 rotas** |

## 11. Pendências que precisam de decisão antes do Controller

1. **`job:delete`** — manter reservada no catálogo (ADMIN=24) e não expor
   rota, ou remover do catálogo (ADMIN=23)? **Recomendação: manter
   reservada.**
2. **Contrato de `RESCHEDULED`** — `201` com a nova entrevista
   (recomendado) ou `200` com `{ old, new }`?
3. **Paginação** — padronizar `?page&limit` em todas as listagens desde
   já.
4. **`interview:update` em entrevista terminal** — `409` (recomendado)
   ou permitir correção de feedback?
5. **Formato do `409` de `deactivate`** — incluir campo `reason`
   estruturado (`cannot_deactivate_self` / `last_active_admin` /
   `already_inactive`) além da `message`? **Recomendação: sim**, para
   facilitar testes e frontend.
6. **`document:read:any` para ADMIN** — adicionar ao catálogo se
   auditoria documental for requisito, ou ADMIN fica só com metadados via
   `application:read:any`?

Este mapa está pronto para virar a Etapa 0.4 do playbook (mapa de
endpoints) antes de abrir os Controllers. Próximo passo natural: derivar
o esqueleto de DTOs por rota (campos + validadores `class-validator`)
para começar a codar direto.
