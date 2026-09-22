# Plataforma de Recrutamento — API (AV-04)

> **Status atual: Fase 2 (Auth/RBAC) fechada de vez na Rodada 7 pelo
> Qwen** (APROVADO COM RESSALVAS) — ver `docs/fases/`. Módulos
> `Companies` e `Jobs` fechados na Rodada 9 (**APROVADO COM RESSALVAS**,
> depois de reprovação na Rodada 8 por 3 críticos de isolamento entre
> empresas e concorrência — todos corrigidos e reverificados sob carga
> maior, 0 violações em 96+ execuções concorrentes). `CandidateProfile`
> implementado (ainda não auditado pelo Qwen). Auth completo, RBAC
> dinâmico de ponta a ponta, filtro global de exceções, integração
> externa de CEP obrigatória do enunciado. **72 testes automatizados
> verdes** — 9 dos 10 cenários obrigatórios de teste já cobertos. O
> DeepSeek já entregou o mapa dos 41 endpoints do restante do domínio
> (Application/Interview/Document/Users/RBAC Nível B) — implementação em
> andamento. Este README é atualizado a cada fase concluída — documento
> histórico da avaliação, não tarefa de última
> hora.

## 1. Objetivo

API backend para uma Plataforma de Recrutamento, com candidatos, empresas,
vagas, candidaturas e entrevistas. Construída em NestJS + TypeScript +
PostgreSQL + Prisma 7.10.0, com JWT, autorização por papel, upload de
currículo, integração externa (CEP/localização) e regras de concorrência
para evitar overselling de vagas.

Especificação completa da avaliação: ver `AV-04-RECRUTAMENTO.md` (fornecido
separadamente pelo avaliador).

## 2. Mapa do que foi implementado

_Esta seção é o contrato de honestidade da entrega: o que é exigido, o que é
bônus, e o que foi além do pedido. Será preenchida progressivamente — nunca
deixamos isso implícito no código._

### 2.1 Obrigatório do enunciado

| Item | Status |
|---|---|
| Modelagem Prisma com relacionamentos, constraints, enums | 🟢 Aprovada com ressalvas pelo Qwen (`prisma/schema.prisma`), migration aplicada |
| Autenticação JWT + `@CurrentUser()` | 🟢 Concluído: registro, login, refresh (com rotação), logout (`src/auth/`) |
| Autorização por papel (CANDIDATE/RECRUITER/ADMIN) | 🟢 RBAC dinâmico funcionando de ponta a ponta: `PATCH /users/:id/deactivate` (`user:manage`) provado com teste e2e — quem tem a permissão passa, quem não tem recebe `403` |
| CRUDs / gestão das entidades | 🟡 `User` (deactivate/reactivate), `Company` (CRUD completo), `Job` (CRUD + transições de status) e `CandidateProfile` (leitura/atualização com visibilidade condicional) implementados; `Application`/`Interview`/`Document` ainda não |
| Consultas por relacionamento | ⬜ Não iniciado |
| Fluxo de estados do domínio (Job, Application, Interview) | 🟡 Desenhado (`docs/fases/FASE-1-MODELAGEM.md`), não implementado |
| Upload de currículo/documento | ⬜ Não iniciado |
| Integração externa via `HttpService` (CEP/localização) | 🟢 Implementado em `Company` (`src/common/cep/cep.service.ts`, reusável para `CandidateProfile` depois) — CEP válido enriquece endereço, CEP inexistente/API fora do ar/timeout nunca bloqueiam a operação principal, endereço fica `null` |
| Interceptor coerente | ⬜ Não iniciado |
| Helmet + Compression | 🟢 Concluído (`src/main.ts`) |
| Tratamento de 400/401/403/404/409 | 🟢 Todos os 5 demonstrados por teste automatizado: 400 (DTO inválido), 401 (API key/JWT ausente ou inválido), 403 (permission key ausente), 404 (recurso inexistente), 409 (email duplicado, inclusive sob concorrência) |
| Build de produção sem erros | 🟢 Concluído (`npm run build` verificado) |
| Testes obrigatórios (10 cenários do enunciado) | 🟡 9 de 10 cobertos por teste automatizado: #1 fluxo com sucesso, #2 body inválido, #3 ausência/token inválido, #4 sem permissão, #5 recurso inexistente, #6 conflito de negócio (`test/auth.e2e-spec.ts`, `test/companies.e2e-spec.ts`, `test/jobs.e2e-spec.ts`), #7 acesso a recurso de terceiro (recrutador de uma empresa tentando ler/alterar vaga de outra, `test/jobs.e2e-spec.ts`), #9 integração externa funcionando e falhando de forma controlada (CEP real, sem mock), #10 fluxo completo de mudança de estado (`DRAFT→OPEN→FILLED`, `test/jobs.e2e-spec.ts`). Falta só: #8 upload válido/inválido (depende de `Document`, ainda não implementado) |

### 2.2 Bônus (só depois do obrigatório)

Paginação, filtros, ordenação, Swagger, seed, testes automatizados, Docker —
todos ⬜ não iniciados.

### 2.3 Além do pedido (diferenciais desta entrega)

- Histórico de status de candidatura (`ApplicationStatusHistory`) como
  entidade auditável, não só um campo de status mutável.
- Observabilidade com Loki/Promtail/Grafana, planejada para a Fase 4
  (pasta `docker/` só aparece no repositório quando tiver arquivo real
  dentro — Git não versiona diretório vazio; correção de imprecisão
  apontada na auditoria Qwen rodada 2).
- Documento de decisões técnicas por fase em `docs/fases/`, revisado por
  duas lentes externas (segurança/ORM e negócio) antes de avançar.
- **API key como camada adicional ao JWT** (recomendação do avaliador, não
  consta no enunciado escrito), aplicada como guard global antes da
  autenticação — ver `docs/fases/FASE-1-MODELAGEM.md` §5.1.
- **RBAC dinâmico via banco** (`Role`/`Permission`/`RolePermission`) em vez
  de papéis fixos em enum, incluindo endpoint de ADMIN para editar
  permissões de um papel em runtime (Nível B, decisão explícita de assumir
  o custo de tempo — ver `docs/fases/FASE-1-MODELAGEM.md` §5.1).
- **Validação de ambiente no boot** (`src/config/env.validation.ts`): a
  aplicação recusa subir se `JWT_SECRET`/`API_KEY` forem os valores de
  exemplo do `.env.example` (ou iguais entre si) — fecha um bypass real de
  autenticação encontrado na auditoria Qwen rodada 4 (qualquer deploy que
  esquecesse de trocar os segredos aceitaria um JWT forjado com o segredo
  público do repositório).
- **Filtro global de exceções do Prisma**
  (`src/common/filters/prisma-exception.filter.ts`): erro de unique/FK/
  conflito de transação nunca vira `500` — mapeado para `400`/`404`/`409`.

### 2.4 Conscientemente fora do escopo

- **`npm audit` reporta 4 vulnerabilidades "high"** em `mysql2`/
  `deepmerge-ts` — são dependências transitivas do **driver MySQL que vem
  dentro do pacote `prisma` (CLI)**, mesmo usando só PostgreSQL. São
  `devDependencies` (não entram no build de produção). `npm audit fix
  --force` resolveria rebaixando para `prisma@6.19.3`, o que quebraria o
  requisito explícito do enunciado (Prisma **7.10.0**) — por isso não foi
  aplicado.
- Rate limiting em `/auth/login` — decisão pendente, será avaliada na
  Fase 2 junto com o `ThrottlerModule` (já instalado).

## 3. Como este projeto foi conduzido

Cada fase tem um documento em `docs/fases/` com: a modelagem/decisão
proposta, o motivo (\"porquê\", não só \"o quê\"), e o veredito das revisões
externas antes de avançar para a próxima fase. Ver `docs/fases/FASE-1-MODELAGEM.md`.

### 3.1 Divergências da estrutura originalmente planejada

O prompt de orquestração inicial deste projeto (documento interno da
equipe, não o enunciado da avaliação) especificava uma estrutura de
pastas e um conjunto de ferramentas específico. Ao longo da
implementação, alguns pontos divergiram — registrado aqui porque nenhuma
dessas mudanças foi anunciada explicitamente no momento em que aconteceu,
e o projeto tem o hábito de documentar decisões, não escondê-las.

**Nenhum desses itens é exigido pelo enunciado da avaliação
(`AV-04-RECRUTAMENTO.md`)** — ele não especifica estrutura de pastas nem
framework de teste; o que ele exige (stack, entidades, regras de negócio,
segurança, testes, documentação) está coberto independente da organização
interna do código.

| Planejado originalmente | Implementado | Motivo |
|---|---|---|
| `src/modules/{auth,users,...}` | `src/{auth,users,companies,jobs}` (sem prefixo `modules/`) | Nenhum — só o jeito como a implementação evoluiu; funcionalmente idêntico, ambos são convenção comum em NestJS |
| `RolesGuard` (papel fixo) | `PermissionsGuard` (RBAC dinâmico via banco) | **Decisão consciente**, documentada desde `FASE-1-MODELAGEM.md` — permite editar permissões em runtime (Nível B), inspirado em auditoria de projeto anterior |
| Jest (`test/jest-e2e.json`) | Vitest (`vitest.config.e2e.ts`) | Escolha de ferramenta feita no scaffolding inicial (Dia 1), nunca revisitada |
| Zod/ClassValidator para ENV | Joi (via `@nestjs/config`) | Escolha de ferramenta; auditado e aprovado pelo Qwen (Fase 2) |
| `TestContainers` nos testes e2e | PostgreSQL local real (`recrutamento_test`) | Evita dependência de Docker rodando durante o desenvolvimento; mesmo princípio (banco real, não mock) |
| `prisma/seeds/` (pasta, dados massivos) | `prisma/seed.ts` (arquivo único, mínimo) | Seed mínimo por fase (RBAC + 1 usuário por papel); dados de domínio completos ficam para quando os módulos existirem |
| Swagger no `main.ts` desde o início | Ainda não implementado | Decisão explícita: implementar só quando os controllers de domínio estabilizarem, para não retrabalhar |
| `ThrottlerGuard` conectado | `@nestjs/throttler` instalado, guard não conectado | Rate limiting é item pendente (N9, `FEEDBACKS-MELHORIA.md`) |
| `.github/workflows/` com CI | Ainda não implementado | Registrado como melhoria futura (`FEEDBACKS-MELHORIA.md` #14) |
| `docker/`, `Dockerfile`, observabilidade | Em construção (sessão paralela) | Trabalho em andamento — ver `docs/fases/` mais recentes |

## 4. Instalação e execução

Passos testados de verdade nesta máquina (Windows, PostgreSQL 18 local,
Node 24). Se algo aqui não funcionar exatamente assim no seu ambiente, é
uma falha de documentação — abra uma issue/avise.

### 4.1 Pré-requisitos

- Node.js 22+ (testado com 24.18.0)
- PostgreSQL 14+ rodando localmente (testado com 18) — pode ser um serviço
  já instalado ou um container, não precisa ser dedicado só a este projeto

**`DATABASE_URL` é obrigatório para qualquer comando do Prisma, inclusive
`prisma generate`** (achado Qwen rodada 5, N6) — mesmo sem um banco
alcançável, a variável precisa existir (um valor qualquer, mesmo
apontando pra um banco que não existe, é suficiente só para gerar o
client). Em CI, defina um `DATABASE_URL` dummy antes de `npm run build`.

### 4.2 Banco de dados

Crie um usuário e dois bancos dedicados (dev e teste) — **não** use o
superusuário `postgres` na aplicação:

```sql
CREATE ROLE recrutamento_app LOGIN PASSWORD 'escolha-uma-senha' CREATEDB;
CREATE DATABASE recrutamento_dev  OWNER recrutamento_app;
CREATE DATABASE recrutamento_test OWNER recrutamento_app;
```

(`CREATEDB` é necessário porque o `prisma migrate dev` cria um banco
"sombra" temporário para calcular diffs de schema.)

### 4.3 Variáveis de ambiente

```bash
cp .env.example .env
```

Edite `DATABASE_URL` com o usuário/senha criados acima, e gere valores
próprios para os segredos (nunca reaproveite os do `.env.example`):

```bash
openssl rand -hex 32   # para JWT_SECRET e JWT_REFRESH_SECRET
openssl rand -hex 24   # para API_KEY
```

Para testes automatizados, crie também um `.env.test` apontando para
`recrutamento_test` (mesmo formato do `.env`).

### 4.4 Instalação e migrations

```bash
npm install
npx prisma migrate dev
```

Isso aplica as migrations e gera o Prisma Client em `src/generated/prisma`
(pasta gerada, fora do Git — recriada por este comando).

### 4.5 Rodando em desenvolvimento

```bash
npm run start:dev
```

A API sobe em `http://localhost:3000` (ou a porta definida em `PORT`).

### 4.6 Build de produção

```bash
npm run build
npm run start:prod
```

### 4.7 Testes

**A suíte assume um banco de teste recém-semeado** (achado Qwen rodada 9,
N6): alguns testes fazem afirmações absolutas sobre o estado do banco
(ex.: "existe exatamente 1 ADMIN ativo") que quebram se outro processo
(inclusive uma sessão de auditoria externa) já tiver criado dados no
mesmo banco antes. Rode sempre `npm run db:reset:test` antes de
`npm run test:e2e` se a suíte falhar de um jeito que pareça "número
errado" em vez de "comportamento errado" — é sinal de banco sujo, não de
bug de produto (o próprio Qwen reproduziu isso e confirmou 10/10 verde
depois do reset).

Requer a migration e o seed aplicados no banco de **teste**
(`recrutamento_test`, configurado em `.env.test` — já versionado com
segredos dedicados só de teste, funciona em clone novo sem configuração
manual):

```bash
npm run db:reset:test
```

Isso derruba e recria só o `recrutamento_test` (nunca toca no
`recrutamento_dev`) e roda o seed em seguida — use sempre que o banco de
teste ficar num estado inconsistente entre execuções (achado Qwen rodada
6, ressalva 9: sem esse comando, um teste interrompido no meio podia
deixar dados residuais que quebravam a próxima rodada).

Internamente é `scripts/db-reset-test.ts` (rodado via `tsx`), não mais o
CLI `dotenv run` direto no `package.json`. **Achado crítico Qwen rodada
7:** a versão anterior (`dotenv run -f .env.test -- prisma migrate reset
--force`) não sobrescrevia um `DATABASE_URL` já exportado no shell — se
alguém tivesse seguido a "alternativa manual" abaixo (que exporta
`DATABASE_URL` na mão) e depois rodasse `db:reset:test`, o comando
apagava **o banco apontado por essa variável, não o de teste**. Provado
pelo Qwen com um "banco canário" descartável. O script novo lê
`.env.test` e monta o ambiente do processo filho com esses valores
**sempre por cima** de qualquer coisa já exportada, e se recusa a rodar
se o nome do banco alvo não contiver `"test"`. Também mantém a
correção da rodada 6: `migrate reset` sozinho, nesta versão do Prisma,
não dispara o seed automaticamente, por isso os dois comandos continuam
explícitos e encadeados dentro do script.

Alternativa manual, comando por comando (o que o script acima faz por
baixo):

```bash
DATABASE_URL="<a mesma URL do seu .env.test>" npx prisma migrate deploy
NODE_ENV=test DATABASE_URL="<idem>" npx tsx prisma/seed.ts
```

Depois:

```bash
npm test        # unitários
npm run test:e2e
```

**Correção de honestidade (achado Qwen rodada 4, C3):** uma versão anterior
deste README dizia "comandos existem e funcionam, mas sem specs de negócio"
— isso era falso: `test:e2e` estava vermelho (o `ApiKeyGuard` já era global
e o teste não enviava a chave). Hoje: **72 testes automatizados, todos
verdes** (68 e2e em `test/app.e2e-spec.ts` + `test/auth.e2e-spec.ts` +
`test/companies.e2e-spec.ts` + `test/jobs.e2e-spec.ts` +
`test/candidate-profile.e2e-spec.ts`, 4 unitários em
`src/app.controller.spec.ts` + `src/common/cep/cep.service.spec.ts`),
cobrindo os cenários obrigatórios de auth (400/401/409, fluxo completo de
registro/login/refresh/logout, uma rota protegida por permission key, e a
trava de último administrador sob concorrência real — 8 admins
temporários, 4 pares de desativação mútua simultânea, nunca `500`), o
CRUD completo de `Company` e `Job` (403/404/409 com `reason` estruturado,
isolamento entre empresas testado com o usuário real do seed, corrida de
transição de status testada com `Promise.all` — 10 rodadas seguidas,
asserção baseada no invariante real, não em quem vence a corrida), a
visibilidade condicional de `CandidateProfile` (reduzido/completo
conforme o status real de uma `Application`, nunca `403`), e a
integração externa de CEP funcionando e falhando de forma controlada
(contra o ViaCEP real, sem mock — o único mock do projeto é o `HttpService`
no teste unitário do
`CepService`, pra provocar timeout de forma determinística). 9 dos 10
cenários obrigatórios do enunciado já cobertos (ver §2.1); falta só #8
(upload), que depende de `Document`, ainda não implementado.

## 5. Endpoints

Preenchida endpoint por endpoint conforme são implementados (achado Qwen
rodada 5, N11 — esta tabela tinha ficado vazia com 5 rotas já reais, o
oposto da política declarada aqui). Todas exigem `x-api-key` (decisão
CE-1, sem exceção nenhuma, nem para as rotas públicas de auth).

| Método | URL | Autenticação/Permissão | Body | Principais respostas |
|---|---|---|---|---|
| `GET` | `/health` | Só API key | — | `200` `{status:"ok",timestamp}` |
| `POST` | `/auth/register` | Só API key | `{name, email, password}` | `201` (tokens); `400` DTO inválido; `409` email duplicado |
| `POST` | `/auth/login` | Só API key | `{email, password}` | `200` (tokens); `401` credenciais inválidas |
| `POST` | `/auth/refresh` | Só API key | `{refreshToken}` | `200` (novo par de tokens); `401` token inválido/expirado/já usado |
| `POST` | `/auth/logout` | JWT | `{refreshToken}` | `204`; `401` sem JWT/JWT inválido |
| `PATCH` | `/users/:id/deactivate` | JWT + permission `user:manage` | — | `200` (usuário atualizado, `isActive: false`); `403` sem a permissão; `404` usuário inexistente; `409` alvo é a própria conta, o último ADMIN ativo, ou conflito de concorrência (tente novamente) |
| `PATCH` | `/users/:id/reactivate` | JWT + permission `user:manage` | — | `200` (usuário atualizado, `isActive: true`, idempotente); `403` sem a permissão; `404` usuário inexistente |
| `POST` | `/companies` | JWT + permission `company:create` | `{name, cnpj?, description?, cep}` | `201`; `400` DTO inválido; `409` CNPJ duplicado (`reason: "cnpj_duplicado"`) |
| `GET` | `/companies/:id` | JWT + permission `company:read` | — | `200`; `404` inexistente ou inativa |
| `PATCH` | `/companies/:id` | JWT + permission `company:update` | `{name?, cnpj?, description?, cep?}` | `200`; `400` DTO inválido; `404` inexistente ou inativa |
| `PATCH` | `/companies/:id/deactivate` | JWT + permission `company:delete` | — | `200` (empresa atualizada, `isActive: false`); `404` inexistente; `409` já inativa (`reason: "company_already_inactive"`) |
| `PATCH` | `/companies/:id/reactivate` | JWT + permission `company:delete` | — | `200` (empresa atualizada, `isActive: true`); `404` inexistente; `409` já ativa (`reason: "company_already_active"`) |
| `POST` | `/jobs` | JWT + permission `job:create` | `{title, description, vacancies, salaryMin?, salaryMax?, isRemote, companyId?}` | `201`; `400` DTO inválido ou `companyId` ausente para ADMIN; `404` `companyId` de outra empresa, inexistente/inativa, ou RECRUITER sem empresa própria |
| `GET` | `/jobs` | Só API key (rota pública) | — (query `?page&limit&search`) | `200` lista só vagas `OPEN` |
| `GET` | `/jobs/mine` | JWT + permission `job:read:any` | — (query `?status&page&limit`) | `200` vagas da própria empresa em qualquer status (ADMIN vê todas) |
| `GET` | `/jobs/:id` | JWT + permission `job:read` | — | `200` se `OPEN`, ou se `job:read:any` + mesma empresa; `404` caso contrário |
| `PATCH` | `/jobs/:id` | JWT + permission `job:update` | `{title?, description?, vacancies?, salaryMin?, salaryMax?, isRemote?}` | `200`; `400` DTO; `404` fora do escopo; `409` `vacancies` abaixo do já preenchido (`reason: "vacancies_below_filled_count"`) |
| `PATCH` | `/jobs/:id/status` | JWT + permission `job:status:update` | `{status}` | `200`; `400` transição inválida (`reason: "invalid_status_transition"`); `404` fora do escopo; `409` `FILLED` sem preencher todas as vagas (`reason: "job_not_fully_filled"`) |
| `GET` | `/candidates/me` | JWT + permission `candidate-profile:read` | — | `200`; `404` perfil ainda não criado |
| `PATCH` | `/candidates/me` | JWT + permission `candidate-profile:update:own` | `{headline?, summary?, phone?, cep?, skills?}` | `200` (upsert — cria na primeira chamada); `400` DTO/CEP |
| `GET` | `/candidates/:userId` | JWT + permission `candidate-profile:read` | — | `200` completo (dono/ADMIN) ou reduzido (RECRUITER com candidatura `PENDING`); `404` não é candidato, sem relação, ou fora do escopo |

**Nota sobre formato de erro:** a partir de `Companies`, respostas `404`/`409`
de regra de negócio ganham um campo `reason` machine-readable além de
`message` (ex.: `{statusCode: 409, reason: "cnpj_duplicado", message: "..."}`)
— sugestão do Qwen/DeepSeek na Fase 2, adotada só para módulos novos. As
rotas de `Auth`/`Users` acima mantêm o formato antigo (sem `reason`), já
auditado, para não reabrir escopo fechado. **Atualizado na rodada 8
(Qwen):** o corpo de erro agora sempre inclui o campo `error` (achado —
dois formatos de `409` conviviam, um com `error` e outro sem), e todo
`403` (de qualquer rota protegida por permission key) ganhou
`reason: "permission_denied"`.

**Nota sobre `deactivate`/`reactivate`:** originalmente essas rotas
devolviam `204` sem corpo (mesmo padrão de `DELETE`). Revisado depois de
`Company` existir, pensando no frontend: `200` com o recurso atualizado
evita uma chamada `GET` extra só para confirmar `isActive`. Mudança só de
contrato de resposta — a lógica de negócio já auditada (trava de último
admin, revogação de refresh tokens, ordem de checagem 404→409) continua
idêntica; verificado reexecutando a suíte completa (`test/auth.e2e-spec.ts`,
incluindo o teste de concorrência de 8 admins, e `test/companies.e2e-spec.ts`).

**Nota sobre transições de status de `Job`:** `DRAFT→{OPEN,CANCELED}`,
`OPEN→{PAUSED,FILLED,CLOSED,CANCELED}`, `PAUSED→{OPEN,CANCELED}`,
`FILLED→CLOSED`; `CLOSED`/`CANCELED` são terminais. `OPEN→CANCELED` foi
uma adição nossa (não estava explícito no fluxo original do DeepSeek,
Fase 1) — cancelar uma vaga aberta é uma necessidade óbvia de negócio.
`OPEN→CLOSED` tinha sido removida sem registro numa versão anterior,
contradizendo o comentário do próprio enum em `schema.prisma`
("`CLOSED`: encerrada definitivamente **sem** preencher todas as vagas")
— achado Qwen rodada 8 (R4), reincluída. `DELETE /jobs/:id`
deliberadamente não existe: soft-delete via
`PATCH /jobs/:id/status {status: "CANCELED"}` preserva candidaturas/
entrevistas/documentos vinculados — `job:delete` fica reservada no
catálogo (ADMIN continua com 24 keys), sem rota.

**Nota sobre `company` embutida nas respostas de vaga (achado Qwen
rodada 8, R1):** `GET /jobs`, `GET /jobs/:id` e `GET /jobs/mine` sempre
trazem `company: {id, name}` — antes o candidato via só `companyId` cru,
sem nenhuma rota que resolvesse isso num nome. A listagem pública
(`GET /jobs`) usa um `select` dedicado que **não** inclui `createdById`
nem `filledCount` (achado R5 — nenhum dos dois pertence a uma vitrine
pública); as rotas autenticadas (`/jobs/mine`, `/jobs/:id`) continuam com
os campos completos.

**Nota sobre visibilidade pública e empresa desativada (achado Qwen
rodada 9, Q3/N8):** uma vaga `OPEN` só é visível publicamente
(`GET /jobs` e `GET /jobs/:id` para quem não é da empresa) se a empresa
dona também estiver ativa — antes, desativar uma empresa não escondia
suas vagas já publicadas, e a vitrine chegava a anunciar uma empresa que
`GET /companies/:id` já dizia "não encontrada". A correção **não**
cascateia o status da vaga (isso destruiria informação que o
`reactivate` de empresa não conseguiria desfazer) — só a visibilidade
pública passou a considerar `company.isActive`. O dono (`job:read:any` +
mesma empresa) continua lendo o próprio histórico normalmente, empresa
ativa ou não.

**Nota sobre visibilidade condicional de `CandidateProfile` (Fase 1,
Pergunta 2 do DeepSeek):** `GET /candidates/:userId` nunca devolve `403`
— sempre `200` (completo ou reduzido) ou `404`. Um RECRUITER só enxerga
o perfil se existir alguma candidatura do candidato pra uma vaga da
própria empresa (`404` caso contrário, mesma política anti-enumeração do
resto do projeto); enxerga **completo** se alguma candidatura já saiu de
`PENDING` (a empresa já tomou alguma ação), senão só o **reduzido**
(`id`, `name`, `headline`, `skills` — sem `summary`/`phone`/endereço). O
dono e o ADMIN sempre veem completo. `PATCH /candidates/me` é *upsert*
de propósito — não existe `POST` separado, o perfil nasce na primeira
atualização.
