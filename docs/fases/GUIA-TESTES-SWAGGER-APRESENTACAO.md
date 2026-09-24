# Guia de Testes no Swagger — Roteiro para Apresentação

Documento de apoio para testar manualmente os 43 endpoints da API direto
no `/docs` (Swagger UI), papel por papel, e para servir de roteiro na
apresentação: o que fazer, o que esperar, e **por quê** aquilo é a regra
de negócio certa — para demonstrar domínio da arquitetura, não só "o
endpoint funciona".

Cada seção de módulo traz uma tabela de rota × quem pode × o que esperar,
seguida de um roteiro numerado de chamadas concretas (positivas e
negativas) com o resultado exato esperado.

---

## 0. Preparação

### 0.1 Subir a API e abrir o Swagger

Pra estudo/treino do dia a dia, a instância nativa basta:

```bash
npm run start:dev
```

Abrir `http://localhost:3000/docs` no navegador.

**Se a intenção for demonstrar o Grafana ao vivo enquanto testa** (achado
da revisão final — ver README §4.9): use a instância **Docker**
(`./docker/compose.sh up -d --build`, Swagger em
`http://localhost:3001/docs`) em vez da nativa. O Promtail só coleta log
de container Docker — testar na `3000` nunca aparece no Grafana, mesmo
com tudo funcionando corretamente (não é bug, é a arquitetura). Os dois
ambientes têm banco/seed/`API_KEY` próprios e independentes.

### 0.2 Aplicar a API key (sempre obrigatória, em toda rota)

Clique em **Authorize** (canto superior direito). No formulário
`api-key (apiKey)`, cole o valor da variável `API_KEY` do seu `.env` e
clique em **Apply credentials**. Isso fica salvo pro resto da sessão do
navegador — não precisa repetir a cada chamada.

Sem isso, **toda** rota (mesmo `/health` e `/auth/login`) devolve `401`
antes de chegar em qualquer lógica de negócio — é a primeira camada de
defesa (`ApiKeyGuard`, `APP_GUARD` global).

### 0.3 Credenciais de teste (seed)

Criadas por `prisma/seed.ts` (rodar `npx prisma db seed` se ainda não
rodou nesta base — comando configurado em `prisma.config.ts`). Senha
igual para os três (variável `SEED_USER_PASSWORD`, ou
`Senha@123` se a variável não estiver definida no `.env`):

| Papel | Email |
|---|---|
| ADMIN | `admin@recrutamento.test` |
| RECRUITER | `recrutador@recrutamento.test` (já nasce vinculado à "Empresa Seed", CNPJ `00000000000191`) |
| CANDIDATE | `candidato@recrutamento.test` |

### 0.4 Pegar um JWT de cada papel

1. Expanda `POST /auth/login`, clique **Try it out**.
2. Corpo: `{"email": "<um dos 3 acima>", "password": "<a senha>"}`.
3. Execute. A resposta traz `accessToken`.
4. Copie **só o valor do token** (sem "Bearer ").
5. Clique **Authorize** de novo → formulário `jwt (http, Bearer)` → cole
   o token → **Apply credentials**.

Para trocar de papel durante os testes, repita o login com outro usuário
e reaplique o token — a API key aplicada não precisa mudar.

> **Ponto de arquitetura para citar na apresentação:** a API key identifica
> o *consumidor da API* (uma camada), o JWT identifica o *usuário logado*
> (outra camada) — são independentes por design; um front-end mal
> configurado sem JWT nunca chega nem perto de checar permissão, porque
> nem passa da primeira guarda.

---

## 1. Arquitetura para narrar durante a demonstração

Pontos que valem ser ditos em voz alta enquanto navega pelo Swagger,
porque não aparecem sozinhos na tela:

1. **Cadeia de 3 guards globais, em ordem fixa**: `ApiKeyGuard` →
   `JwtAuthGuard` → `PermissionsGuard`. Cada um só deixa passar pro
   próximo se o anterior passou — por isso um 401 de API key nunca vira
   um 403 de permissão (a ordem importa e já foi auditada pelo Qwen).
2. **RBAC dinâmico via banco**, não enum fixo no código: `Role` →
   `RolePermission` → `Permission`. A tabela `Papéis (RBAC)` no Swagger
   (`GET /roles`, `PUT /roles/:id/permissions`) edita isso em runtime —
   um ADMIN pode dar/tirar uma permissão de um papel inteiro sem deploy.
3. **Nunca um 500 documentado**: todo erro esperado (validação, conflito,
   não encontrado, sem permissão) é mapeado pelo `GlobalExceptionFilter`
   para 400/401/403/404/409 com corpo `{statusCode, error, message,
   reason?}`. Rotas mais antigas (Auth, `deactivate`/`reactivate` de
   User/Company) usam o formato sem `reason`; rotas mais novas (Fase 4)
   usam o formato com `reason` — os dois formatos aparecem
   deliberadamente lado a lado no Swagger, e o motivo está documentado no
   README §5.
4. **Anti-enumeração**: um recrutador tentando acessar vaga/candidatura/
   entrevista/documento de OUTRA empresa recebe **404**, nunca 403 — pra
   não confirmar pra um atacante que aquele ID existe.
5. **Payload condicional** (não é tudo-ou-nada): `Application`,
   `CandidateProfile` e o vínculo de `Document` mudam o que devolvem
   dependendo do progresso da candidatura — ver §4.6/§4.5/§4.8 abaixo.
   Isso é regra de NEGÓCIO (privacidade do candidato antes da empresa
   demonstrar interesse real), não só um detalhe técnico.
6. **Escrita atômica sob concorrência**: contratar um candidato
   (`HIRED`), trocar permissões de um papel, e desativar/trocar o papel
   de um usuário rodam dentro de transação `Serializable` com checagem de
   invariante — testado com `Promise.all` real (não dá pra demonstrar ao
   vivo no Swagger de forma confiável, mas vale citar que os 151 testes
   incluem corridas de até 45 requisições simultâneas).

---

## 2. Matriz de permissões por papel

| Papel | Nº de permissões | O que faz, em uma frase |
|---|---|---|
| CANDIDATE | 8 | Vê vagas abertas, candidata-se, gerencia o próprio perfil/documentos/candidaturas |
| RECRUITER | 13 | Gerencia vagas e candidaturas da PRÓPRIA empresa, agenda entrevistas |
| ADMIN | 24 | Tudo, exceto as 4 ações exclusivas de candidato (candidatar-se, desistir, editar o próprio perfil, subir documento) |

Catálogo completo em [`src/common/constants/permissions.constants.ts`](../../src/common/constants/permissions.constants.ts).

---

## 3. Saúde e Autenticação

| Rota | Quem pode | 2xx | Erros esperados |
|---|---|---|---|
| `GET /health` | Qualquer um com API key | 200 | 401 sem API key |
| `POST /auth/register` | Público (com API key) | 201, sempre cria CANDIDATE | 400 DTO inválido · 409 email já cadastrado |
| `POST /auth/login` | Público (com API key) | 200 | 400 DTO inválido · 401 credenciais erradas |
| `POST /auth/refresh` | Público (com API key) | 200, novo par de tokens | 401 refresh token inválido/expirado/já usado/revogado |
| `POST /auth/logout` | Autenticado (JWT) | 204 | 401 sem JWT válido |

**Roteiro sugerido:**
1. `GET /health` sem aplicar API key → **401**. Reaplique a API key.
2. `GET /health` de novo → **200**.
3. `POST /auth/register` com um email novo → **201**, confirme que o
   `user.role` retornado é `CANDIDATE` mesmo sem você ter pedido isso no
   corpo (a rota nem aceita esse campo).
4. `POST /auth/register` de novo com o MESMO email → **409**.
5. `POST /auth/login` com senha errada → **401** (mesma mensagem genérica
   de "credenciais inválidas" tanto pra email inexistente quanto pra
   senha errada — não revela qual dos dois está errado).
6. `POST /auth/refresh` usando um `refreshToken` já usado antes → **401**
   (rotação: usar de novo o mesmo token é tratado como token comprometido).

---

## 4. Usuários (ADMIN only — todas as 6 rotas exigem `user:read`/`user:manage`)

| Rota | 2xx | Erros esperados |
|---|---|---|
| `GET /users` | 200 | 401 · 403 (RECRUITER/CANDIDATE) |
| `GET /users/:id` | 200 | 401 · 403 · 404 |
| `PATCH /users/:id/company` | 200 | 400 `company_id_obrigatorio` (campo ausente, ≠ enviar `null`) · 403 · 404 · 409 `usuario_nao_e_recrutador` |
| `PATCH /users/:id/role` | 200 | 403 · 404 · 409 `recrutador_com_vagas_ativas` / `last_active_admin` / `concorrencia_transacao` |
| `PATCH /users/:id/deactivate` | 200 (`isActive: false`) | 403 · 404 · 409 "própria conta" / "último administrador" / já inativo |
| `PATCH /users/:id/reactivate` | 200 (`isActive: true`) | 403 · 404 · 409 já ativo |

**Roteiro sugerido (logado como ADMIN):**
1. `GET /users` → 200, lista todos (sem `password`/hash nenhum no corpo —
   aponte isso, é o `omit` global do Prisma).
2. Troque pro token de RECRUITER e repita `GET /users` → **403**
   (`user:read` não está nas 13 permissões dele).
3. De volta como ADMIN: `PATCH /users/:id/deactivate` no seu PRÓPRIO id
   (o id do admin logado) → **409**, "não pode desativar a própria
   conta" — mesmo sendo ADMIN.
4. Se só existir 1 ADMIN ativo na base: tente desativar ELE por outra
   via (não dá, é a mesma trava) — cite que existe uma segunda trava
   idêntica em `updateRole` (trocar o papel do último admin pra
   RECRUITER também é bloqueado, `409 last_active_admin`).
5. `PATCH /users/:id/company` no usuário CANDIDATE seed, com
   `{"companyId": 1}` → **409** `usuario_nao_e_recrutador` (só RECRUITER
   pode ter empresa).

---

## 5. Empresas

| Rota | ADMIN | RECRUITER | CANDIDATE | Público (sem JWT) |
|---|---|---|---|---|
| `POST /companies` | 201 | 403 (`company:create` não é dele) | 403 | — |
| `GET /companies/:id` | 200 | 200 (tem `company:read`, de QUALQUER empresa) | 403 | — |
| `PATCH /companies/:id` | 200 | 403 | 403 | — |
| `PATCH /companies/:id/deactivate` | 200/409 | 403 | 403 | — |
| `PATCH /companies/:id/reactivate` | 200/409 | 403 | 403 | — |
| `GET /companies/:id/stats` | 200 (qualquer empresa) | 200 só da PRÓPRIA / 404 de outra | 403 | — |
| `GET /cep/:cep` | 200 | 200 | 200 | 200 (só API key) |

**Roteiro sugerido:**
1. Como ADMIN, `POST /companies` com um CEP válido (ex.: `01310-100`) →
   **201**, endereço enriquecido automaticamente (rua/cidade/estado
   vieram da integração externa, não do corpo que você mandou).
2. `POST /companies` de novo com um CEP inexistente (ex.: `00000-000`) →
   **400** `cep_nao_encontrado` — a criação inteira é rejeitada, não só
   o campo do CEP.
3. `PATCH /companies/:id/deactivate` na empresa criada → **200**,
   `isActive: false`.
4. Repita o mesmo `deactivate` → **409** `company_already_inactive`
   (idempotência: a segunda chamada não é um erro genérico, é um estado
   já alcançado).
5. Troque pro RECRUITER e tente `GET /companies/:id` da empresa DELE
   mesmo (a "Empresa Seed") → **200** (ele tem `company:read`, só não
   pode criar/editar).
6. **`GET /cep/:cep` isolado** (item além do pedido, §2.3 do README):
   `GET /cep/01310-100` só com API key (sem JWT) → **200**
   `{street, city, state}` — mostra que o frontend pode implementar
   "digite o CEP, autopreenche o formulário" ANTES de submeter qualquer
   coisa. Repita com `00000-000` → **400** `cep_nao_encontrado`; e com um
   formato errado (`123`) → **400** `cep_formato_invalido`.
7. **`GET /companies/:id/stats`** (bônus "indicadores do domínio"): como
   RECRUITER da "Empresa Seed", chame a rota → **200** com `jobs.byStatus`
   e `applications.byStatus`. Se ainda não houver candidatura nenhuma,
   `conversionRate`/`avgTimeToHireDays` vêm `null` (não `0` — destaque
   isso, é a diferença entre "não sabemos" e "a taxa é zero"). Tente a
   mesma rota como RECRUITER pra uma empresa que NÃO é a dele → **404**
   (mesmo padrão anti-enumeração do resto do projeto, mesmo tendo
   `company:read`). Como ADMIN, a mesma rota funciona pra qualquer
   empresa.

---

## 6. Vagas

| Rota | ADMIN | RECRUITER | CANDIDATE | Público (sem JWT) |
|---|---|---|---|---|
| `POST /jobs` | 201 (precisa `companyId` no corpo) | 201 (usa a própria empresa) | 403 | — |
| `GET /jobs` (vitrine) | — | — | — | 200, só vagas `OPEN` |
| `GET /jobs/mine` | 200 (todas empresas) | 200 (só a própria) | 403 | — |
| `GET /jobs/:id` | 200 | 200 (qualquer status, se for da própria empresa) | 200 só se `OPEN`, senão 404 | — |
| `PATCH /jobs/:id` | 200 | 200 (só da própria empresa) | 403 | — |
| `PATCH /jobs/:id/status` | 200/400 | 200/400 | 403 | — |

**Roteiro sugerido:**
1. `GET /jobs` **sem aplicar JWT nenhum** (só API key) → **200** — é a
   vitrine pública, só API key. Aponte que ela só lista `OPEN`.
2. Como RECRUITER, `POST /jobs` com `vacancies: 2`, status nasce `DRAFT`
   → **201**.
3. `GET /jobs` (vitrine pública) → a vaga criada **não aparece** (está
   `DRAFT`, não `OPEN`).
4. `PATCH /jobs/:id/status` `{"status": "OPEN"}` → **200**. Repita
   `GET /jobs` público → agora aparece.
5. `PATCH /jobs/:id/status` `{"status": "CLOSED"}` direto de `OPEN` para
   `CLOSED` → **200** (transição válida). Tente `{"status": "OPEN"}` de
   novo a partir de `CLOSED` → **400** `invalid_status_transition`
   (`CLOSED` é terminal, sem saída — cite a máquina de estados:
   `DRAFT→OPEN→{PAUSED,FILLED,CLOSED,CANCELED}`, sem rota de exclusão
   física, só `CANCELED`).
6. Como CANDIDATE, `GET /jobs/:id` de uma vaga `DRAFT` de OUTRA empresa
   → **404** (não 403 — anti-enumeração; se fosse 403 confirmaria que a
   vaga existe).
7. Crie um segundo RECRUITER de outra empresa (ou simule) e tente
   `PATCH /jobs/:id` numa vaga que não é da empresa dele → **404**
   (mesmo padrão, mesmo ele tendo `job:update`).
8. **Ordenação configurável** (bônus): `GET /jobs?sortOrder=asc` inverte
   a ordem padrão (`createdAt desc`) sem mudar o campo — a vaga mais
   ANTIGA aparece primeiro. Mesmo parâmetro funciona em `/jobs/mine`,
   `/applications/me`, `/jobs/:jobId/applications` e `/users`.

---

## 7. Perfil de Candidato

| Rota | CANDIDATE (dono) | RECRUITER | ADMIN |
|---|---|---|---|
| `GET /candidates/me` | 200/404 (perfil ainda não criado) | 403 (rota é só "me") | 403 |
| `PATCH /candidates/me` | 200 (upsert) | 403 | 403 |
| `GET /candidates/:userId` | 200 (se `userId` for ele mesmo) | 200 completo ou reduzido (depende da candidatura) / 404 | 200 sempre completo |

**Payload condicional** (o coração deste módulo): um RECRUITER só vê o
perfil de um candidato se existir alguma `Application` dele pra uma vaga
da empresa do recrutador. Dentro disso:
- Sem nenhuma candidatura para a empresa → **404** (nunca revela que o
  perfil existe).
- Candidatura ainda `PENDING` → **200 reduzido**: só `id`, `name`,
  `headline`, `skills` (nada de telefone/CEP/resumo).
- Candidatura em `UNDER_REVIEW`/`INTERVIEW`/`OFFERED`/`HIRED` → **200
  completo**.
- Candidatura `REJECTED`/`WITHDRAWN` → some para **reduzido** de novo,
  nunca fica em completo depois de encerrada (achado Qwen rodada 10: a
  versão antiga tratava desistência do candidato como se fosse "avanço",
  o oposto do que deveria acontecer).

**Roteiro sugerido:**
1. Como CANDIDATE, `PATCH /candidates/me` preenchendo tudo, com CEP
   válido → **200**, endereço enriquecido.
2. Como RECRUITER, `GET /candidates/:userId` desse candidato SEM ele ter
   se candidatado a nenhuma vaga da empresa → **404**.
3. Como CANDIDATE, candidate-se a uma vaga da empresa do recrutador
   (ver §8). Como RECRUITER, repita `GET /candidates/:userId` → agora
   **200 reduzido** (só nome/headline/skills — sem telefone).
4. Como RECRUITER, avance a candidatura pra `UNDER_REVIEW` (ver §8).
   Repita `GET /candidates/:userId` → agora **200 completo**.
5. Avance a candidatura pra `REJECTED`. Repita → volta pra **reduzido**.

---

## 8. Candidaturas

| Rota | CANDIDATE | RECRUITER | ADMIN |
|---|---|---|---|
| `POST /jobs/:jobId/applications` | 201 (só ele mesmo) | 403 | 403 |
| `GET /applications/me` | 200 (só as próprias) | 403 | 403 |
| `GET /jobs/:jobId/applications` | 403 | 200 (só da própria empresa) | 200 (todas as empresas) |
| `GET /applications/:id` | 200/404 (dono) | 200 completo/reduzido/404 | 200 completo |
| `PATCH /applications/:id/status` | 403 | 200/400/404/409 | 200/400/404/409 |
| `PATCH /applications/:id/withdraw` | 200/400 (dono) | 403 | 403 |

> Nota de correção: cheguei a suspeitar, só olhando o catálogo, que ADMIN
> não teria `application:read:job` (só `read:any`) e cairia em 403 nessa
> rota. Testei ao vivo (`GET /jobs/999999/applications` como ADMIN) e veio
> **404 `job_not_found`**, não 403 — ou seja, o guard deixou passar
> normalmente. `ADMIN_PERMISSIONS` é "todo o catálogo exceto as 4 keys
> exclusivas de candidato", e `application:read:job` não é uma delas, então
> ADMIN tem sim essa key. Sem problema aqui — deixo o registro só pra
> mostrar que toda suspeita deste guia foi checada contra o servidor real
> antes de virar afirmação, não só deduzida da leitura do código.

**Roteiro sugerido:**
1. Como CANDIDATE, `POST /jobs/:jobId/applications` numa vaga `OPEN` →
   **201**, status nasce `PENDING`.
2. Repita a MESMA chamada (mesmo candidato, mesma vaga) → **409**
   `candidatura_duplicada`.
3. Como CANDIDATE, tente se candidatar a uma vaga `DRAFT`/`CLOSED` →
   **404** (vaga não visível/não `OPEN`).
4. Como RECRUITER, `GET /applications/:id` dessa candidatura → **200
   reduzido** (`PENDING` ainda não é status de "avaliação em
   andamento" — sem `coverLetter` completo/perfil, só o mínimo de
   triagem).
5. `PATCH /applications/:id/status` `{"status": "UNDER_REVIEW"}` →
   **200**. Repita `GET /applications/:id` → agora **200 completo**.
6. Tente pular direto de `UNDER_REVIEW` para `HIRED` (pulando
   `INTERVIEW`/`OFFERED`) → **400** `invalid_status_transition`.
7. Avance corretamente até `OFFERED`, depois `{"status": "HIRED"}` →
   **200**, e note que isso incrementa `Job.filledCount` — se a vaga já
   estava com `filledCount === vacancies`, essa mesma chamada devolve
   **409** (capacidade esgotada) em vez de estourar o limite.
8. Como CANDIDATE, `PATCH /applications/:id/withdraw` numa candidatura já
   `HIRED` → **400** (status terminal, não admite desistência depois de
   contratado).

---

## 9. Entrevistas

| Rota | RECRUITER/ADMIN | CANDIDATE |
|---|---|---|
| `POST /applications/:applicationId/interviews` | 201/409 | **403 sempre** |
| `GET /applications/:applicationId/interviews` | 200 | **403 sempre** |
| `GET /interviews/:id` | 200 | **403 sempre** |
| `PATCH /interviews/:id` | 200/201/409 | **403 sempre** |

> **Achado real desta preparação, vale mencionar na apresentação como
> ponto de discussão, não como bug escondido:** `CANDIDATE_PERMISSIONS`
> não inclui nenhuma key de `interview:*`. Isso significa que, hoje, o
> PRÓPRIO candidato não consegue ver a data/horário da própria entrevista
> agendada por nenhuma rota da API — só o recrutador/admin vê. Pode ser
> intencional (a comunicação da entrevista acontece por fora, ex. email)
> ou pode ser uma lacuna a discutir com o DeepSeek/Qwen. Testando ao vivo:
> logado como CANDIDATE, qualquer rota de `/interviews` devolve
> **403 `permission_denied`**, mesmo sendo o dono da candidatura.

**Roteiro sugerido:**
1. Como RECRUITER, tente `POST /applications/:applicationId/interviews`
   numa candidatura ainda `UNDER_REVIEW` (não `INTERVIEW`) → **409**
   `application_not_in_interview_stage`.
2. Avance a candidatura até `INTERVIEW` (§8). Repita o `POST` → **201**.
3. `PATCH /interviews/:id` `{"status": "COMPLETED", "feedback": "..."}`
   → **200**.
4. Repita `PATCH` na mesma entrevista (já `COMPLETED`, status terminal)
   → **409** `interview_ja_encerrada`.
5. Numa entrevista ainda `SCHEDULED`, `PATCH /interviews/:id`
   `{"status": "RESCHEDULED", "scheduledAt": "<nova data>"}` → repare que
   o código HTTP muda pra **201** (não 200!) e o corpo é uma entrevista
   NOVA (`id` diferente, `previousInterviewId` apontando pra original).
   Esse é o contrato mais incomum da API — vale destacar.

---

## 10. Documentos

| Rota | Dono | Outro CANDIDATE | RECRUITER da empresa certa | RECRUITER de outra empresa |
|---|---|---|---|---|
| `POST /documents` | 201/400 | — | 403 (não tem `document:upload:own`) | — |
| `GET /documents/me` | 200 (só os dele) | — | 403 | — |
| `GET /documents/:id` | 200 (download) | 404 | 200 condicional / 404 | 404 |

**Regra de escopo do RECRUITER** (a mais estrita do projeto — achado
crítico Qwen rodada 12, K6): não basta o documento ser de um candidato
que se candidatou na empresa. Só libera se o documento foi **anexado
como `resumeDocumentId`** de uma `Application` daquela empresa E com
status em `UNDER_REVIEW`/`INTERVIEW`/`OFFERED`/`HIRED`. Um documento
pessoal do candidato nunca anexado a nenhuma candidatura é invisível pra
qualquer recrutador, mesmo que o candidato tenha outras candidaturas
ativas na mesma empresa.

**Roteiro sugerido:**
1. Como CANDIDATE, `POST /documents` com um `.pdf` e `type: "RESUME"` →
   **201**.
2. Tente de novo com um `.exe` ou `.txt` → **400** (MIME não permitido).
3. Tente com um arquivo maior que `MAX_UPLOAD_SIZE_MB` (5MB por padrão)
   → **400** `arquivo_excede_tamanho_maximo` (não 413 cru do multer).
4. Como RECRUITER da empresa onde o candidato NUNCA se candidatou,
   `GET /documents/:id` → **404**.
5. Candidate-se a uma vaga da empresa SEM anexar esse documento
   (`resumeDocumentId` vazio no `POST /jobs/:jobId/applications`). Como
   RECRUITER, `GET /documents/:id` → ainda **404** (não fica visível só
   por existir uma candidatura — precisa do vínculo explícito).
6. Candidate-se de novo, desta vez anexando o documento
   (`resumeDocumentId` no corpo). Avance a candidatura pra
   `UNDER_REVIEW`. Como RECRUITER, `GET /documents/:id` agora → **200**,
   baixa o arquivo.

---

## 11. Papéis (RBAC)

| Rota | ADMIN | RECRUITER/CANDIDATE |
|---|---|---|
| `GET /roles` | 200 | 403 |
| `GET /roles/:id` | 200 | 403 |
| `PUT /roles/:id/permissions` | 200/400/409 | 403 |

**Roteiro sugerido (o mais impressionante pra apresentação — RBAC de
verdade em runtime):**
1. `GET /roles` → mostra as 3 roles com suas permissões atuais.
2. Pegue o `id` da role `RECRUITER`. `PUT /roles/:id/permissions` com a
   lista de `permissionIds` **sem** o id de `job:create` → **200**.
3. Faça login de novo como RECRUITER (ou use um token já ativo) e tente
   `POST /jobs` → agora **403** — a mudança em runtime, sem deploy nem
   reiniciar o servidor, já bloqueou a ação.
4. Devolva a permissão (`PUT` de novo com a lista completa) pra deixar o
   ambiente como estava.
5. Tente `PUT /roles/:id/permissions` na role ADMIN removendo TODAS as
   permissões que incluem `role:manage` → **409**
   `sem_papel_com_role_manage` — o sistema nunca deixa chegar a um estado
   sem NENHUMA role que consiga se autogerenciar.

---

## 12. Roteiro sugerido para a apresentação (tempo curto)

Se o tempo for curto, esta sequência cobre guards, RBAC dinâmico,
anti-enumeração, payload condicional, máquina de estados e o contrato
mais incomum (RESCHEDULED) em ~10 chamadas:

1. `GET /health` sem API key → 401. Com API key → 200. *(guard 1)*
2. `GET /jobs` (vitrine, sem JWT) → 200 só `OPEN`. *(rota pública real)*
3. Login como CANDIDATE → `POST /jobs/:jobId/applications` → 201, repita
   → 409 duplicada. *(regra de negócio obrigatória do enunciado)*
4. Login como RECRUITER → `GET /applications/:id` da candidatura acima →
   200 reduzido (ainda `PENDING`). *(payload condicional)*
5. `PATCH /applications/:id/status` → `UNDER_REVIEW` → repita o GET →
   200 completo. *(mesma regra, do outro lado)*
6. Como CANDIDATE, tente `GET /users` (rota de ADMIN) → 403.
   *(RBAC/PermissionsGuard)*
7. Como RECRUITER, tente `GET /jobs/:id` de uma vaga de outra empresa →
   404, não 403. *(anti-enumeração)*
8. Como ADMIN, `PUT /roles/:id/permissions` tirando uma permissão do
   RECRUITER, e mostre o 403 novo na hora. *(RBAC dinâmico em runtime —
   o ponto mais forte da entrega)*
9. Avance uma entrevista pra `RESCHEDULED` e mostre o `201` com o novo
   registro. *(contrato incomum, mostra atenção a detalhe)*
10. Abra `/documents/:id` de um documento nunca anexado → 404 pro
    recrutador, mesmo tendo candidatura ativa do mesmo candidato.
    *(regra de escopo mais fina do projeto, achado crítico corrigido)*
