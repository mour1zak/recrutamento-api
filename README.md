# Plataforma de Recrutamento — API (AV-04)

> **Status atual: Fase 2 (Auth/RBAC) fechada de vez na Rodada 7 pelo
> Qwen** (APROVADO COM RESSALVAS) — ver `docs/fases/`. Módulos
> `Companies` e `Jobs` fechados na Rodada 9 (**APROVADO COM RESSALVAS**,
> depois de reprovação na Rodada 8 por 3 críticos de isolamento entre
> empresas e concorrência — todos corrigidos e reverificados sob carga
> maior, 0 violações em 96+ execuções concorrentes). `CandidateProfile`
> fechado na Rodada 11 (**APROVADO COM RESSALVAS**, depois de reprovação
> na Rodada 10 por 2 críticos de vazamento de PII — recrutador de empresa
> desativada lendo perfil completo, e status `REJECTED`/`WITHDRAWN`
> destravando dados completos indevidamente — todos fechados sob ataque
> mais amplo: matriz completa de status, cross-tenant, ciclo desativar/
> reativar). Achado novo da Rodada 11 (contrato de CEP inválido vs. falha
> de rede, especificado desde a Fase 1 e nunca implementado) também
> corrigido. **Fase 4** (Application, Interview, Document, gestão de
> Users e RBAC Nível B — os 41 endpoints do mapa do DeepSeek) **fechada na
> Rodada 13** (**APROVADO COM RESSALVAS**, depois de reprovação na Rodada
> 12 com 6 críticos — todos por ausência de atomicidade em escrita
> concorrente, ou propagação incompleta de proteções já existentes —
> reatacados com carga MAIOR que a que os encontrou na reapresentação:
> taxas de 60-100% caíram a 0% em até 45 rodadas de concorrência real).
> Novo `CHECK (filledCount <= vacancies)` na migration fecha um item do
> Gate Fase 3 pendente desde a Fase 1. Auth completo, RBAC dinâmico de
> ponta a ponta, filtro global de exceções, integração externa de CEP
> obrigatória do enunciado, upload de documento com validação de
> MIME/tamanho. **Obrigatório do enunciado 100% concluído** — o interceptor
> era o único item pendente (`LoggingInterceptor`, global, loga
> método/rota/status/duração sem tocar no corpo; rejeições de guard/rota
> logadas pelo `GlobalExceptionFilter`, achado Qwen rodada 14). Aprovado
> pelo Qwen na Rodada 14 depois de uma reprovação por asserção de teste de
> concorrência exclusiva demais (não por defeito no interceptor) — a
> mesma classe de erro da rodada 9, agora com regra escrita pro projeto:
> testes de concorrência sempre assertam o invariante final e o conjunto
> de desfechos aceitos, nunca um único ramo específico — suíte completa
> rodada 8× seguidas sem falha depois da correção. **Os 10 dos 10
> cenários obrigatórios de teste** do enunciado cobertos. **Gate Fase 3
> (concorrência) fechado**: as duas
> invariantes de `Job.filledCount`/`vacancies` validadas dentro da mesma
> transação, `CHECK` de banco confirmado sobrevivendo a migrations
> posteriores, trigger de `updatedAt` pra qualquer SQL bruto (com um
> achado real de fuso horário corrigido — `CURRENT_TIMESTAMP` puro grava
> hora local, não UTC, numa coluna sem fuso), índice único
> case-insensitive de `User.email`, e pool de conexão do `pg` com timeout
> explícito. **158 testes automatizados verdes** (9 unitários + 149 e2e).
> **Bônus concluídos**: Docker (multi-stage, Postgres, migrations
> automáticas), Observabilidade (Loki + Promtail + Grafana), Seed, e
> Swagger (`/docs`, público por decisão de produto — Rodada 15 do Qwen,
> ver §2.2 —, 42 endpoints documentados em português, incluindo
> `GET /cep/:cep` além do mapa original de 41). Este
> README é atualizado a cada fase concluída — documento histórico da
> avaliação, não tarefa de última hora.

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
| CRUDs / gestão das entidades | 🟢 `User` (deactivate/reactivate/company/role + listagem), `Company`, `Job`, `CandidateProfile`, `Application`, `Interview` e `Document` (upload/leitura) implementados — os 7 do enunciado |
| Consultas por relacionamento | 🟢 `GET /jobs*` traz `company`; `CandidateProfile`/`Document` atravessam `Application → Job → Company`; `Interview` atravessa `Application → Job` |
| Fluxo de estados do domínio (Job, Application, Interview) | 🟢 `Job` (rodada 8/9), `Application` (`PENDING→...→HIRED`/`REJECTED`/`WITHDRAWN`, com histórico em `ApplicationStatusHistory`) e `Interview` (`SCHEDULED→COMPLETED/CANCELED/NO_SHOW/RESCHEDULED`, reagendamento cria novo registro) implementados e testados |
| Upload de currículo/documento | 🟢 `POST /documents` (multipart, MIME whitelist + limite de 5MB), `GET /documents/:id` com escopo condicional (dono, ou recrutador com candidatura `UNDER_REVIEW`+) |
| Integração externa via `HttpService` (CEP/localização) | 🟢 Implementado em `Company` e `CandidateProfile` (`src/common/cep/cep.service.ts`) — contrato discriminado desde a Rodada 11: CEP válido enriquece endereço; CEP que o provedor confirma não existir **rejeita** a operação (`400 cep_nao_encontrado`, achado Qwen N1 — antes ficava indistinguível de falha de rede); só falha de REDE/timeout não bloqueia (endereço `null` na criação, preservado na atualização, com `addressWarning` na resposta). Também exposto como consulta independente em `GET /cep/:cep` (§2.3) pro frontend autopreencher o formulário antes de submeter |
| Interceptor coerente | 🟢 `LoggingInterceptor` (`src/common/interceptors/`) global via `APP_INTERCEPTOR` — loga método/rota/status/duração/id do usuário de toda requisição que passa pelos guards, sem tocar no corpo (nunca vaza senha/token). Rejeições de guard (401/403) e rota inexistente (404) não passam por interceptor nenhum no Nest — logadas separadamente pelo `GlobalExceptionFilter` (achado Qwen rodada 14) |
| Helmet + Compression | 🟢 Concluído (`src/main.ts`) |
| Tratamento de 400/401/403/404/409 | 🟢 Todos os 5 demonstrados por teste automatizado: 400 (DTO inválido), 401 (API key/JWT ausente ou inválido), 403 (permission key ausente), 404 (recurso inexistente), 409 (email duplicado, inclusive sob concorrência) |
| Build de produção sem erros | 🟢 Concluído (`npm run build` verificado) |
| Testes obrigatórios (10 cenários do enunciado) | 🟢 **10 de 10** cobertos por teste automatizado: #1 fluxo com sucesso, #2 body inválido, #3 ausência/token inválido, #4 sem permissão, #5 recurso inexistente, #6 conflito de negócio, #7 acesso a recurso de terceiro (recrutador de uma empresa tentando ler/alterar vaga/candidatura/entrevista de outra), #8 upload válido/inválido (`test/documents.e2e-spec.ts` — MIME e tamanho), #9 integração externa funcionando e falhando de forma controlada (CEP real, sem mock), #10 fluxo completo de mudança de estado (`DRAFT→OPEN→FILLED` em Job, `PENDING→...→HIRED` em Application) |

### 2.2 Bônus (só depois do obrigatório)

| Item | Status |
|---|---|
| Paginação/filtros/ordenação | 🟡 `?page&limit` em toda listagem (`PaginationQueryDto` compartilhado); filtros por status/role/companyId/isActive já existem nas listagens que fazem sentido; ordenação fixa (`createdAt desc`), não configurável pelo cliente ainda |
| Testes automatizados | 🟢 151 testes (9 unitários + 142 e2e), muito além do mínimo — já contam como bônus mesmo sendo também ferramenta de auditoria |
| Seed | 🟢 `prisma/seed.ts` — catálogo de permissões, papéis, um usuário de cada papel |
| **Docker** | 🟢 **Concluído e verificado por execução dos dois lados** — `Dockerfile` multi-stage (deps/build/runtime, usuário não-root), `docker/compose.dev.yml` (API + Postgres + migrations automáticas via `prisma migrate deploy`), volumes persistentes (Postgres + uploads, com permissão corrigida pro usuário `node`), porta da API mapeada em `3001` (não conflita com o dev local em `3000`) |
| **Observabilidade** | 🟢 **Concluída** — `docker/compose.obs.yml` com Loki + Promtail + Grafana, dashboard provisionado automaticamente filtrando os logs do container da API (`container="recrutamento-api"`), confirmado recebendo os logs do `LoggingInterceptor`/`GlobalExceptionFilter` em tempo real |
| **Swagger** | 🟢 **Concluído, auditado pelo Qwen (Rodada 15) e corrigido** — `@nestjs/swagger` em `/docs`/`/docs-json`, **deliberadamente públicos** (decisão final do produto, revertendo a recomendação do Qwen de exigir `x-api-key`: chegamos a implementar isso com fallback de Basic Auth pro navegador, mas a UX do popup nativo pedindo "usuário/senha" pra uma chave sem conceito de usuário foi considerada pior que o risco residual — ver `docs/fases/TRIAGEM-REVISOES-RODADA15.md`). A correção que de fato importava permanece: o `example` de `LoginDto` publicava a credencial REAL do ADMIN do seed — corrigido, com teste e2e de regressão em `test/docs.e2e-spec.ts` garantindo que nenhuma credencial real do seed apareça no spec publicado. Todos os 42 endpoints documentados em 11 tags em português (os 41 do mapa original + `GET /cep/:cep`, adicionado depois — ver §2.3), `@ApiOperation`/`@ApiResponse` cobrindo todo código HTTP que cada rota realmente retorna (nunca um `500` documentado — confirmado pelo Qwen em 175 respostas na Rodada 15), schemas de resposta com a distinção payload completo × reduzido em `CandidateProfile`/`Application`/`Job`, todas as propriedades de DTO com `@ApiProperty`/`@ApiPropertyOptional` e descrição em português, upload multipart com schema de arquivo, e os dois esquemas de segurança (`x-api-key`, `Bearer JWT`) funcionais no botão "Authorize" |

Docker/observabilidade implementados numa VM Debian em paralelo (outra sessão do Claude Code, guiada pelo usuário), revisados aqui por leitura + verificação empírica cruzada (ex.: o achado de `UPLOAD_DIR`/`MAX_UPLOAD_SIZE_MB` sem efeito, corrigido neste lado; o achado de permissão do volume de uploads, corrigido do lado deles).

### 2.3 Além do pedido (diferenciais desta entrega)

- **`GET /cep/:cep`** — consulta de CEP independente, pública (`@Public()`
  + API key, sem JWT — mesma classe de utilidade que `GET /jobs`
  vitrine), reaproveitando o `CepService` já existente. Permite o
  frontend implementar "digite o CEP, autopreenche rua/cidade/estado"
  ANTES de submeter o formulário de `Company`/`CandidateProfile`, que já
  resolviam CEP internamente mas só como parte do envio completo. Mesmo
  contrato discriminado do Service, mapeado pra HTTP: `ok` → `200`;
  `invalid` → `400 cep_nao_encontrado` (mesmo `reason` de Companies/
  CandidateProfile); `unavailable` → `502` (falha do provedor externo,
  não de quem perguntou — status HTTP diferente de propósito, pra não
  confundir com CEP realmente inexistente). Testado contra o ViaCEP real,
  sem mock, mesmo padrão do resto do projeto.
- Histórico de status de candidatura (`ApplicationStatusHistory`) como
  entidade auditável, não só um campo de status mutável.
- Observabilidade com Loki/Promtail/Grafana — implementada e verificada
  (ver §2.2), dashboard já filtrando os logs da API em tempo real.
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
| Swagger no `main.ts` desde o início | Implementado depois, quando os 8 controllers de domínio já estavam estáveis | Decisão explícita registrada nesta mesma linha desde a Fase 2: implementar só quando os controllers estabilizassem, para não retrabalhar — cumprida, e concluída (ver §2.2) |
| `ThrottlerGuard` conectado | `@nestjs/throttler` instalado, guard não conectado | Rate limiting é item pendente (N9, `FEEDBACKS-MELHORIA.md`) |
| `.github/workflows/` com CI | Ainda não implementado | Registrado como melhoria futura (`FEEDBACKS-MELHORIA.md` #14) |
| `docker/`, `Dockerfile`, observabilidade | 🟢 Concluído (sessão paralela, revisado aqui) | Ver §2.2 |

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
e o teste não enviava a chave). Hoje: **151 testes automatizados, todos
verdes** (142 e2e em `test/app.e2e-spec.ts` + `test/auth.e2e-spec.ts` +
`test/companies.e2e-spec.ts` + `test/jobs.e2e-spec.ts` +
`test/candidate-profile.e2e-spec.ts` + `test/applications.e2e-spec.ts` +
`test/interviews.e2e-spec.ts` + `test/documents.e2e-spec.ts` +
`test/users.e2e-spec.ts` + `test/roles.e2e-spec.ts` +
`test/gate-fase3.e2e-spec.ts`, 9 unitários em
`src/app.controller.spec.ts` + `src/common/cep/cep.service.spec.ts` +
`src/roles/roles.service.spec.ts` + `src/common/interceptors/logging.interceptor.spec.ts`),
cobrindo os cenários obrigatórios de
auth (400/401/409, fluxo completo de registro/login/refresh/logout, uma
rota protegida por permission key, e a trava de último administrador sob
concorrência real — 8 admins temporários, 4 pares de desativação mútua
simultânea, nunca `500`), o CRUD completo de `Company`/`Job` (403/404/409
com `reason` estruturado, isolamento entre empresas testado com o
usuário real do seed, corrida de transição de status testada com
`Promise.all`), a visibilidade condicional de `CandidateProfile`
(reduzido/completo conforme o status real de uma `Application`, nunca
`403`), a integração externa de CEP funcionando e falhando de forma
controlada (contra o ViaCEP real, sem mock, para os cenários e2e — o
único mock do projeto é o `HttpService` no teste unitário do
`CepService`, pra provocar de forma determinística os três resultados do
contrato discriminado: `ok`/`invalid`/`unavailable`, achado Qwen rodada
11), a regra obrigatória de candidatura duplicada e vaga inativa
(`test/applications.e2e-spec.ts`), a concorrência real de contratação
(duas `HIRED` simultâneas na última vaga — `Promise.all`, exatamente uma
vence, `reason: "no_vacancies_left"` na outra, nunca `5xx`), o contrato
de `RESCHEDULED` de `Interview` (`201` com a nova entrevista, original
vira `RESCHEDULED`), e o upload de documento com MIME/tamanho inválidos
(`test/documents.e2e-spec.ts`, cenário obrigatório #8). **10 dos 10**
cenários obrigatórios do enunciado cobertos (ver §2.1).

**Achado Qwen rodada 12 (Fase 4 reprovada → corrigida):** 6 críticos de
concorrência/escopo, todos com teste de reprodução real adicionado —
reduzir `vacancies` durante uma contratação em voo (`filledCount >
vacancies` corrigido com SQL coluna×coluna + `CHECK` novo na migration),
duas travas de "último" (RBAC `role:manage` e ADMIN) furadas por escrita
concorrente sem transação (corrigidas com o mesmo `Serializable` de
`deactivate()`), e escopo de empresa desativada faltando em 3 módulos.
`vitest.config.e2e.ts` passou a rodar arquivos e2e em sequência
(`fileParallelism: false`) — necessário pra testar agregados globais
(contagem de admins ativos) sem risco de interferência entre arquivos.

**Gate Fase 3 (concorrência), fechado:** `test/gate-fase3.e2e-spec.ts`
cobre as proteções de banco que só fazem sentido testar contra SQL bruto,
não pela API — índice único case-insensitive de `User.email` rejeitando
duplicata via `INSERT` cru, trigger de `updatedAt` disparando mesmo num
`UPDATE` que não o menciona, e o `CHECK (filledCount <= vacancies)`
rejeitando uma escrita via Prisma Client com SQLSTATE `23514`
identificável. Achado real no processo (não hipotético): a primeira
versão do trigger usava `CURRENT_TIMESTAMP` puro, que o Postgres converte
pelo TimeZone da SESSÃO antes de gravar numa coluna sem fuso — ficava ~3h
dessincronizado do que o Prisma Client escreve (sempre UTC). Pego pelo
teste, não por inspeção de código; corrigido com `AT TIME ZONE 'UTC'`
explícito.

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
| `GET` | `/candidates/:userId` | JWT + permission `candidate-profile:read` | — | `200` completo (dono/ADMIN, ou RECRUITER com candidatura em `UNDER_REVIEW`/`INTERVIEW`/`OFFERED`/`HIRED`) ou reduzido (RECRUITER só com candidatura `PENDING`/`REJECTED`/`WITHDRAWN` — achado Qwen rodada 10, C2: lista positiva, não "diferente de `PENDING`"); `404` não é candidato, sem relação, empresa do recrutador desativada, ou fora do escopo |
| `POST` | `/jobs/:jobId/applications` | JWT + permission `application:create` | `{coverLetter?, resumeDocumentId?}` | `201`; `400` DTO/`resumeDocumentId` não pertence a você; `404` vaga inexistente ou empresa inativa; `409` candidatura duplicada (`reason: "candidatura_duplicada"`) ou vaga não `OPEN` (`reason: "job_not_open"`) |
| `GET` | `/applications/me` | JWT + permission `application:read:own` | — (query `?status&page&limit`) | `200` só as do `@CurrentUser()` |
| `GET` | `/jobs/:jobId/applications` | JWT + permission `application:read:job` | — (query `?status&page&limit`) | `200`; `404` vaga fora do escopo (empresa diferente) |
| `GET` | `/applications/:id` | JWT (sem `@Permissions()` — precisa de OU entre `read:own`/`read:job`/`read:any`, decidido no Service) | — | `200` completo (dono/ADMIN, ou recrutador com status `UNDER_REVIEW`+) ou reduzido (recrutador com `PENDING`); `403` nenhuma das 3 keys; `404` fora do escopo |
| `PATCH` | `/applications/:id/status` | JWT + permission `application:status:update` | `{status, reason?}` | `200`; `400` transição inválida; `404` fora do escopo; `409` `HIRED` sem vaga disponível (`reason: "no_vacancies_left"`) ou mudança concorrente (`reason: "application_status_changed_concurrently"`) |
| `PATCH` | `/applications/:id/withdraw` | JWT + permission `application:withdraw:own` | `{reason?}` | `200`; `404` não é o dono; `409` candidatura já em status final (`reason: "application_ja_encerrada"`) |
| `POST` | `/applications/:applicationId/interviews` | JWT + permission `interview:create` | `{scheduledAt, interviewerId?}` | `201`; `400` DTO; `404` candidatura fora do escopo; `409` candidatura não está em `INTERVIEW` (`reason: "application_not_in_interview_stage"`) |
| `GET` | `/applications/:applicationId/interviews` | JWT + permission `interview:read` | — | `200`; `404` fora do escopo |
| `GET` | `/interviews/:id` | JWT + permission `interview:read` | — | `200`; `404` fora do escopo |
| `PATCH` | `/interviews/:id` | JWT + permission `interview:update` | `{status?, feedback?, scheduledAt?}` | `200` (edição normal) ou **`201` com a NOVA entrevista** quando `status: "RESCHEDULED"` (a original vira `RESCHEDULED`, contrato do DeepSeek); `400` `scheduledAt` ausente no reagendamento; `404` fora do escopo; `409` entrevista já em status final |
| `POST` | `/documents` | JWT + permission `document:upload:own` | `multipart/form-data`: `file` + `type` | `201 {id, filename, mimeType, sizeBytes}`; `400` arquivo ausente (`reason: "arquivo_ausente"`), MIME não permitido (`reason: "mime_type_invalido"`) ou tamanho excedido — 5MB (`reason: "arquivo_excede_tamanho_maximo"`) |
| `GET` | `/documents/me` | JWT + permission `document:read:own` | — | `200` lista os próprios |
| `GET` | `/documents/:id` | JWT (sem `@Permissions()` — OU entre `read:own`/`read:application`) | — | `200` (stream/download); `403` nenhuma das 2 keys; `404` fora do escopo. **Regra exata do `read:application`** (achado Qwen rodada 12/13, K6): só o documento **anexado como `resumeDocumentId`** de uma candidatura da empresa do recrutador, com status `UNDER_REVIEW`+, libera — não "qualquer documento do candidato" (isso vazava documentos nunca enviados à empresa, ex.: um laudo médico). Efeito colateral aceito conscientemente: `COVER_LETTER`/`CERTIFICATE`/`OTHER` nunca ficam visíveis a recrutador nenhum hoje, porque `Application` só tem um slot de anexo (`resumeDocumentId`) — um modelo de anexos explícito (`FEEDBACKS-MELHORIA.md`) resolveria isso, fora do escopo desta fase. Também: `REJECTED` remove o acesso ao currículo já anexado (mesma minimização de dados do `CandidateProfile`), decisão registrada aqui pra não ser "consertada" como bug depois |
| `GET` | `/users` | JWT + permission `user:read` | — (query `?role&companyId&isActive&page&limit`) | `200` lista paginada |
| `GET` | `/users/:id` | JWT + permission `user:read` | — | `200` (sem `password`); `404` |
| `PATCH` | `/users/:id/company` | JWT + permission `user:manage` | `{companyId: number\|null}` | `200`; `404` usuário/empresa inexistente; `409` alvo não é RECRUITER (`reason: "usuario_nao_e_recrutador"`) |
| `PATCH` | `/users/:id/role` | JWT + permission `user:manage` | `{roleId}` | `200`; `404` usuário/papel inexistente; `409` RECRUITER com vagas ativas (`reason: "recrutador_com_vagas_ativas"`) ou removeria o último ADMIN (`reason: "last_active_admin"`) |
| `GET` | `/roles` | JWT + permission `role:manage` | — | `200` lista com `permissions[]` aninhadas (RBAC Nível B) |
| `GET` | `/roles/:id` | JWT + permission `role:manage` | — | `200`; `404` |
| `PUT` | `/roles/:id/permissions` | JWT + permission `role:manage` | `{permissionIds: number[]}` | `200` substitui o conjunto inteiro (efeito imediato, sem novo login — permissões são recalculadas do banco a cada request); `400` `permissionId` inexistente; `404` papel inexistente; `409` deixaria o sistema sem nenhum papel com `role:manage` (`reason: "sem_papel_com_role_manage"`) **ou** conflito de concorrência (`reason: "concorrencia_transacao"`, achado Qwen rodada 13 — a transação `Serializable` que fecha o K2 pode gerar esse `409` em dois `PUT`s simultâneos mesmo em papéis diferentes e sem nenhum dos dois tocar `role:manage`, porque os dois leem o mesmo predicado global; é seguro e retryável, não indica erro do cliente) |

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
