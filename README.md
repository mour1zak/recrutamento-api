# Plataforma de Recrutamento — API (AV-04)

> **Status: entrega completa.** Todo o obrigatório do enunciado está
> implementado e testado — autenticação JWT, RBAC dinâmico de ponta a
> ponta, as 7 entidades do domínio com seus fluxos de estado, upload de
> documento com validação de MIME/tamanho, integração externa de CEP com
> tratamento de timeout/indisponibilidade, interceptor de logging, filtro
> global de exceções (nunca um `500` para erro esperado), e build de
> produção limpo. **Os 10 de 10 cenários de teste obrigatórios** do
> enunciado estão cobertos. O **Gate de concorrência** (proteção contra
> overselling de vagas e outras corridas) está fechado: as duas
> invariantes de `Job.filledCount`/`vacancies` validadas dentro da mesma
> transação, `CHECK` de banco, trigger de auditoria (`updatedAt`) em UTC,
> índice único case-insensitive de `User.email`, e pool de conexão do
> `pg` com timeout explícito. **168 testes automatizados verdes** (12
> unitários + 156 e2e).
>
> **Todos os itens de bônus do enunciado concluídos:** paginação, filtros
> e ordenação configurável (`?sortOrder=asc|desc`) em toda listagem;
> Seed; testes automatizados (168, muito além do mínimo); Docker
> (multi-stage, Postgres, migrations automáticas); indicadores do domínio
> (`GET /companies/:id/stats` — vagas por status, funil de candidaturas,
> taxa de conversão, tempo médio até contratação, além da observabilidade
> de infraestrutura via Loki/Grafana); e Swagger (`/docs`, 43 endpoints
> documentados em português, incluindo `GET /cep/:cep` e
> `GET /companies/:id/stats` além do mapa original de 41 rotas).
>
> Este projeto passou por múltiplas rodadas de revisão técnica
> independente ao longo do desenvolvimento — uma frente de planejamento
> de arquitetura/negócio (definição da matriz de permissões e do mapa de
> endpoints) e uma frente adversarial de QA/segurança (auditoria de
> código contra execução real, não só leitura, com poder de reprovar uma
> entrega até os achados serem corrigidos e reverificados sob carga
> maior). O histórico completo, achado por achado, com o motivo de cada
> decisão, é registro interno de processo e não acompanha esta entrega.
> Este README reflete o estado final; as notas técnicas ao longo do
> documento (formato de erro, transições de estado, contratos de
> payload) explicam decisões específicas com mais detalhe.

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
| Modelagem Prisma com relacionamentos, constraints, enums | 🟢 Validada na revisão técnica (`prisma/schema.prisma`), migration aplicada |
| Autenticação JWT + `@CurrentUser()` | 🟢 Concluído: registro, login, refresh (com rotação), logout (`src/auth/`) |
| Autorização por papel (CANDIDATE/RECRUITER/ADMIN) | 🟢 RBAC dinâmico funcionando de ponta a ponta: `PATCH /users/:id/deactivate` (`user:manage`) provado com teste e2e — quem tem a permissão passa, quem não tem recebe `403` |
| CRUDs / gestão das entidades | 🟢 `User` (deactivate/reactivate/company/role + listagem), `Company`, `Job`, `CandidateProfile`, `Application`, `Interview` e `Document` (upload/leitura) implementados — os 7 do enunciado |
| Consultas por relacionamento | 🟢 `GET /jobs*` traz `company`; `CandidateProfile`/`Document` atravessam `Application → Job → Company`; `Interview` atravessa `Application → Job` |
| Fluxo de estados do domínio (Job, Application, Interview) | 🟢 `Job`, `Application` (`PENDING→...→HIRED`/`REJECTED`/`WITHDRAWN`, com histórico em `ApplicationStatusHistory`) e `Interview` (`SCHEDULED→COMPLETED/CANCELED/NO_SHOW/RESCHEDULED`, reagendamento cria novo registro) implementados e testados |
| Upload de currículo/documento | 🟢 `POST /documents` (multipart, MIME whitelist + limite de 5MB), `GET /documents/:id` com escopo condicional (dono, ou recrutador com candidatura `UNDER_REVIEW`+) |
| Integração externa via `HttpService` (CEP/localização) | 🟢 Implementado em `Company` e `CandidateProfile` (`src/common/cep/cep.service.ts`) — contrato discriminado: CEP válido enriquece endereço; CEP que o provedor confirma não existir **rejeita** a operação (`400 cep_nao_encontrado` — antes ficava indistinguível de falha de rede); só falha de REDE/timeout não bloqueia (endereço `null` na criação, preservado na atualização, com `addressWarning` na resposta). Também exposto como consulta independente em `GET /cep/:cep` (§2.3) pro frontend autopreencher o formulário antes de submeter |
| Interceptor coerente | 🟢 `LoggingInterceptor` (`src/common/interceptors/`) global via `APP_INTERCEPTOR` — loga método/rota/status/duração/id do usuário de toda requisição que passa pelos guards, em JSON estruturado (`{"event":"http_request",...}`, fácil de indexar no Grafana/Loki), sem tocar no corpo (nunca vaza senha/token). Rejeições de guard (401/403) e rota inexistente (404) não passam por interceptor nenhum no Nest — logadas separadamente pelo `GlobalExceptionFilter`, em `WARN` (reservado a esse tráfego de segurança, nunca erro de negócio comum), sem duplicar a linha quando a requisição já foi logada pelo interceptor |
| Helmet + Compression | 🟢 Concluído (`src/main.ts`) |
| Tratamento de 400/401/403/404/409 | 🟢 Todos os 5 demonstrados por teste automatizado: 400 (DTO inválido), 401 (API key/JWT ausente ou inválido), 403 (permission key ausente), 404 (recurso inexistente), 409 (email duplicado, inclusive sob concorrência) |
| Build de produção sem erros | 🟢 Concluído (`npm run build` verificado) |
| Testes obrigatórios (10 cenários do enunciado) | 🟢 **10 de 10** cobertos por teste automatizado: #1 fluxo com sucesso, #2 body inválido, #3 ausência/token inválido, #4 sem permissão, #5 recurso inexistente, #6 conflito de negócio, #7 acesso a recurso de terceiro (recrutador de uma empresa tentando ler/alterar vaga/candidatura/entrevista de outra), #8 upload válido/inválido (`test/documents.e2e-spec.ts` — MIME e tamanho), #9 integração externa funcionando e falhando de forma controlada (CEP real, sem mock), #10 fluxo completo de mudança de estado (`DRAFT→OPEN→FILLED` em Job, `PENDING→...→HIRED` em Application) |

### 2.2 Bônus (só depois do obrigatório)

| Item | Status |
|---|---|
| Paginação/filtros/ordenação | 🟢 `?page&limit` em toda listagem (`PaginationQueryDto` compartilhado); filtros por status/role/companyId/isActive já existem nas listagens que fazem sentido; **ordenação configurável** via `?sortOrder=asc\|desc` (o campo continua fixo por listagem — `createdAt` na maioria, `id` em `GET /users` — por escolha deliberada: aceitar um nome de coluna arbitrário via query string abriria uma superfície de risco desnecessária) |
| Testes automatizados | 🟢 168 testes (12 unitários + 156 e2e), muito além do mínimo — já contam como bônus mesmo sendo também ferramenta de auditoria |
| Seed | 🟢 `prisma/seed.ts` — catálogo de permissões, papéis, um usuário de cada papel |
| **Docker** | 🟢 **Concluído e verificado por execução** — `Dockerfile` multi-stage (deps/build/runtime, usuário não-root), `docker/compose.dev.yml` (API + Postgres + migrations automáticas via `prisma migrate deploy`), volumes persistentes (Postgres + uploads, com permissão corrigida pro usuário `node`), porta da API mapeada em `3001` (não conflita com o dev local em `3000`) |
| **Observabilidade (infraestrutura)** | 🟢 **Concluída** — `docker/compose.obs.yml` com Loki + Promtail + Grafana, dashboard provisionado automaticamente filtrando os logs do container da API (`container="recrutamento-api"`), confirmado recebendo os logs do `LoggingInterceptor`/`GlobalExceptionFilter` em tempo real |
| **Indicadores do domínio (negócio)** | 🟢 **Concluído** — `GET /companies/:id/stats`: vagas por status, funil de candidaturas por status, taxa de conversão (`HIRED`/total) e tempo médio até contratação (calculado a partir de `ApplicationStatusHistory`, não estimado). RECRUITER só vê a própria empresa (`404` anti-enumeração pra outra); ADMIN vê qualquer uma. Métrica de negócio, distinta da observabilidade de infraestrutura da linha acima |
| **Swagger** | 🟢 **Concluído e revisado** — `@nestjs/swagger` em `/docs`/`/docs-json`, **deliberadamente públicos** (decisão de produto: chegou a ser implementada uma exigência de `x-api-key` com fallback de Basic Auth pro navegador, mas a UX do popup nativo pedindo "usuário/senha" pra uma chave sem conceito de usuário foi considerada pior que o risco residual). Todos os 43 endpoints documentados em 11 tags em português (os 41 do mapa original + `GET /cep/:cep` + `GET /companies/:id/stats`, adicionados depois — ver §2.3), `@ApiOperation`/`@ApiResponse` cobrindo todo código HTTP que cada rota realmente retorna (nunca um `500` documentado), schemas de resposta com a distinção payload completo × reduzido em `CandidateProfile`/`Application`/`Job`, todas as propriedades de DTO com `@ApiProperty`/`@ApiPropertyOptional` e descrição em português, upload multipart com schema de arquivo, e os dois esquemas de segurança (`x-api-key`, `Bearer JWT`) funcionais no botão "Authorize" |

Docker/observabilidade implementados em paralelo numa frente de trabalho
de infraestrutura, revisados aqui por leitura + verificação empírica
cruzada (ex.: o achado de `UPLOAD_DIR`/`MAX_UPLOAD_SIZE_MB` sem efeito,
corrigido neste lado; o achado de permissão do volume de uploads,
corrigido na frente de infraestrutura).

### 2.3 Além do pedido (diferenciais desta entrega)

- **CORS habilitado** (`src/common/cors.config.ts`) — não exigido pelo
  enunciado (que não previa um frontend consumindo a API), mas necessário
  pra qualquer cliente rodando no navegador (porta diferente da API é
  bloqueada pelo same-origin policy sem isso). `CORS_ORIGIN` no `.env`
  restringe a origens específicas (lista separada por vírgula); sem a
  variável, aceita qualquer origem — conveniente em desenvolvimento, e
  seguro porque CORS não é a camada de autorização deste projeto (API key
  + JWT continuam obrigatórios em toda rota de negócio independente de
  quem pode chamar via navegador).
- **`GET /companies/:id/stats`** — indicadores de negócio (bônus
  "indicadores do domínio", ver §2.2): vagas por status, funil de
  candidaturas por status, taxa de conversão e tempo médio até
  contratação. O tempo médio é calculado a partir de
  `ApplicationStatusHistory` real (diferença entre a criação da
  candidatura e a transição pra `HIRED`), não estimado. RECRUITER só vê a
  própria empresa — diferente de `GET /companies/:id` (que qualquer
  RECRUITER lê de qualquer empresa, decisão já validada anteriormente),
  dados agregados de contratação são informação competitiva e mereceram
  um escopo mais estrito, com `404` anti-enumeração pra empresa de
  terceiro.
- **Ordenação configurável** (`?sortOrder=asc|desc`) em `GET /jobs`,
  `GET /jobs/mine`, `GET /applications/me`, `GET /jobs/:jobId/applications`
  e `GET /users` — fecha o bônus de paginação/filtros/ordenação por
  completo. Só a direção é exposta via query string, não o nome do campo:
  aceitar uma coluna arbitrária do cliente tornaria qualquer campo do
  banco ordenável por fora, um risco desnecessário pra um ganho pequeno;
  o campo continua sendo o mesmo já usado como padrão em cada listagem.
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
- Decisões técnicas revisadas por duas lentes externas (segurança/
  arquitetura e negócio) antes de avançar de fase.
- **API key como camada adicional ao JWT** (recomendação do avaliador, não
  consta no enunciado escrito), aplicada como guard global antes da
  autenticação.
- **RBAC dinâmico via banco** (`Role`/`Permission`/`RolePermission`) em vez
  de papéis fixos em enum, incluindo endpoint de ADMIN para editar
  permissões de um papel em runtime (Nível B, decisão explícita de assumir
  o custo de tempo).
- **Validação de ambiente no boot** (`src/config/env.validation.ts`): a
  aplicação recusa subir se `JWT_SECRET`/`API_KEY` forem os valores de
  exemplo do `.env.example` (ou iguais entre si) — fecha um bypass real de
  autenticação encontrado na revisão técnica (qualquer deploy que
  esquecesse de trocar os segredos aceitaria um JWT forjado com o segredo
  público do repositório).
- **Filtro global de exceções do Prisma**
  (`src/common/filters/prisma-exception.filter.ts`): erro de unique/FK/
  conflito de transação nunca vira `500` — mapeado para `400`/`404`/`409`.

### 2.4 Conscientemente fora do escopo

- **`npm audit` reporta 4 vulnerabilidades "high"** em `mysql2`/
  `deepmerge-ts` — são dependências transitivas do **driver MySQL que vem
  dentro do pacote `prisma` (CLI)**, mesmo usando só PostgreSQL. `prisma`
  é `devDependency` direta do projeto, mas também é **peer dependency
  opcional de `@prisma/client`** — e o npm instala peer deps opcionais
  por padrão. Na prática isso significa que um `npm ci --omit=dev`
  sozinho **ainda instala `prisma`** na imagem de produção (confirmado:
  `npm audit --omit=dev` continua acusando as 4 vulnerabilidades). Por
  isso o `Dockerfile` usa `npm ci --omit=dev --omit=optional` no estágio
  de runtime, o que exclui `prisma` de vez (`npm audit --omit=dev
  --omit=optional` dá 0 vulnerabilidades). `npm audit fix --force`
  resolveria rebaixando para `prisma@6.19.3`, o que quebraria o requisito
  explícito do enunciado (Prisma **7.10.0**) — por isso não foi aplicado.
- Rate limiting em `/auth/login` — decisão pendente (`@nestjs/throttler`
  já instalado, guard não conectado).

## 3. Como este projeto foi conduzido

Cada fase teve um documento próprio com: a modelagem/decisão proposta, o
motivo ("porquê", não só "o quê"), e o veredito das revisões externas
antes de avançar para a próxima fase. Esse registro é interno de
processo e não acompanha esta entrega; as decisões que sobrevivem até o
produto final estão descritas com o mesmo nível de detalhe ao longo
deste README.

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
| `RolesGuard` (papel fixo) | `PermissionsGuard` (RBAC dinâmico via banco) | **Decisão consciente**, tomada na fase de modelagem — permite editar permissões em runtime (Nível B), inspirado em auditoria de projeto anterior |
| Jest (`test/jest-e2e.json`) | Vitest (`vitest.config.e2e.ts`) | Escolha de ferramenta feita no scaffolding inicial (Dia 1), nunca revisitada |
| Zod/ClassValidator para ENV | Joi (via `@nestjs/config`) | Escolha de ferramenta; validada na revisão técnica |
| `TestContainers` nos testes e2e | PostgreSQL local real (`recrutamento_test`) | Evita dependência de Docker rodando durante o desenvolvimento; mesmo princípio (banco real, não mock) |
| `prisma/seeds/` (pasta, dados massivos) | `prisma/seed.ts` (arquivo único, mínimo) | Seed mínimo por fase (RBAC + 1 usuário por papel); dados de domínio completos ficam para quando os módulos existirem |
| Swagger no `main.ts` desde o início | Implementado depois, quando os 8 controllers de domínio já estavam estáveis | Decisão explícita registrada desde a Fase 2: implementar só quando os controllers estabilizassem, para não retrabalhar — cumprida, e concluída (ver §2.2) |
| `ThrottlerGuard` conectado | `@nestjs/throttler` instalado, guard não conectado | Rate limiting é item pendente |
| `.github/workflows/` com CI | Ainda não implementado | Registrado como melhoria futura |
| `docker/`, `Dockerfile`, observabilidade | 🟢 Concluído (frente de trabalho separada, revisado aqui) | Ver §2.2 |

## 4. Instalação e execução

Passos testados de verdade nesta máquina (Windows, PostgreSQL 18 local,
Node 24). Se algo aqui não funcionar exatamente assim no seu ambiente, é
uma falha de documentação — abra uma issue/avise.

### 4.1 Pré-requisitos

- Node.js **22+** (testado com **24.18.0**) — `npm` vem junto (testado com
  **11.16.0**); versão mínima travada em `package.json` (`engines.node`)
- PostgreSQL **14+** rodando localmente (testado com **18**) — pode ser um
  serviço já instalado ou um container, não precisa ser dedicado só a
  este projeto
- `git` pra clonar o repositório

Nenhuma outra ferramenta de sistema é necessária — todo o resto (Nest,
Prisma, TypeScript, bibliotecas de validação/segurança) vem do
`npm install`, com a versão exata travada em `package-lock.json`. As
peças que o enunciado exige por nome, com a versão que este projeto usa:

| Dependência | Versão | Onde |
|---|---|---|
| NestJS (`@nestjs/core`/`common`) | `^12.0.1` | `package.json` |
| Prisma (`prisma` CLI + `@prisma/client`) | `^7.10.0` (exigido pelo enunciado) | `package.json`, `prisma.config.ts` |
| `@prisma/adapter-pg` (driver adapter) | `^7.10.0` | `prisma/schema.prisma` (`provider = "prisma-client"`, sem engine binário — modo driver adapter) |
| `pg` (driver Postgres) | `^8.23.0` | `src/prisma/prisma.service.ts` |
| TypeScript | `^6.0.2` | `tsconfig.json` |
| Vitest (test runner) | `^4.1.2` | `vitest.config.ts`, `vitest.config.e2e.ts` |
| `@nestjs/swagger` | `^12.0.2` | `src/common/swagger.config.ts` |
| `class-validator`/`class-transformer` | `^0.15.1`/`^0.5.1` | DTOs em todo `src/**/dto/` |

`prisma generate` **não** exige um `DATABASE_URL` real: `prisma.config.ts`
tem um fallback (`postgresql://placeholder:placeholder@...`) usado quando
a variável não existe, já que gerar o client só lê o schema, sem tocar o
banco. Comandos que **conectam de verdade** (`migrate`, `db push`,
`db seed`) precisam de um `DATABASE_URL` real e apontando para um banco
alcançável — sem isso, falham com um erro de conexão no momento em que
tentam usá-lo.

### 4.2 Banco de dados

Duas opções — escolha uma. As duas terminam no mesmo lugar: dois bancos
(`recrutamento_dev`/`recrutamento_test`) e uma `DATABASE_URL` pra colocar
no `.env` no próximo passo.

**Opção A — já tem PostgreSQL instalado localmente:**

Abra um cliente SQL conectado como **superusuário** do Postgres (quem
instalou definiu a senha dele):

- **Windows**: o instalador não coloca `psql` no PATH por padrão. Abra o
  PowerShell e rode (ajuste a versão, ex. `18`, conforme a sua instalação):
  ```powershell
  & "C:\Program Files\PostgreSQL\18\bin\psql.exe" -U postgres -h localhost
  ```
- **Linux/macOS**: normalmente `psql` já está no PATH — `psql -U postgres -h localhost`.
- Alternativa em qualquer sistema: pgAdmin (GUI, instalado junto com o
  Postgres na maioria das distribuições) — abra uma "Query Tool" contra o
  servidor local.

Depois de conectado, crie um usuário e dois bancos dedicados (dev e
teste) — **não** use o superusuário `postgres` na aplicação:

```sql
CREATE ROLE recrutamento_app LOGIN PASSWORD 'escolha-uma-senha' CREATEDB;
CREATE DATABASE recrutamento_dev  OWNER recrutamento_app;
CREATE DATABASE recrutamento_test OWNER recrutamento_app;
```

(`CREATEDB` é necessário porque o `prisma migrate dev` cria um banco
"sombra" temporário para calcular diffs de schema.)

**Opção B — não tem PostgreSQL instalado (só Docker):** a aplicação
continua rodando nativa (`npm run start:dev`), só o banco fica num
container — sem `psql`, sem `CREATE ROLE` manual, a imagem oficial do
Postgres cria usuário e banco sozinha a partir de variáveis de ambiente
(mesmo mecanismo que `docker/compose.obs.yml` já usa e tem verificado;
esta combinação específica de comandos ainda não foi testada de ponta a
ponta numa máquina limpa — se algo não bater, é o tipo de coisa que vale
reportar):

```bash
cp docker/.env.example docker/.env
# edite docker/.env: troque POSTGRES_PASSWORD e defina
# POSTGRES_DB=recrutamento_dev
./docker/compose.sh up -d postgres
# cria o segundo banco (o de teste) dentro do mesmo container:
./docker/compose.sh exec postgres createdb -U recrutamento recrutamento_test
```

(`./docker/compose.sh` — não `docker compose -f docker/compose.dev.yml`
direto — porque é ele quem sabe carregar `docker/.env`; rodar o comando
puro do diretório raiz procuraria um `.env` ali, que é o do app, não o
do Docker, e as variáveis `POSTGRES_*` viriam vazias.)

A porta é `5433` (não `5432`) de propósito, pra não conflitar com um
Postgres nativo que porventura já esteja rodando na máquina. `DATABASE_URL`
fica `postgresql://recrutamento:<sua-senha>@localhost:5433/recrutamento_dev?schema=public`
(troque `recrutamento_dev` por `recrutamento_test` no `.env.test`, §4.3).

### 4.3 Variáveis de ambiente

```bash
cp .env.example .env
```

Edite `DATABASE_URL` com o usuário/senha criados acima, e gere valores
próprios para os segredos (nunca reaproveite os do `.env.example`):

```bash
openssl rand -hex 32   # para JWT_SECRET
openssl rand -hex 24   # para API_KEY
```

(O refresh token é opaco — aleatório + hash, não um JWT assinado — não
existe uma segunda chave de assinatura pra ele; só `JWT_SECRET` é usado
pra assinar o access token.)

Para testes automatizados, crie também um `.env.test` (mesmo formato do
`.env`, **nunca versionado** — só `.env.test.example` existe no
repositório):

```bash
cp .env.test.example .env.test
```

Edite `DATABASE_URL` apontando pro banco de teste (`recrutamento_test`,
mesmo usuário `recrutamento_app`), e gere segredos **próprios, diferentes
dos do `.env` de dev**:

```bash
openssl rand -hex 32   # para JWT_SECRET
openssl rand -hex 24   # para API_KEY
```

**Nota de segurança registrada por transparência:** numa versão anterior
deste projeto, `.env.test` chegou a ser versionado com credenciais reais
(inclusive reaproveitando a mesma senha do Postgres local usada no `.env`
de dev) — decisão pensada pra evitar configuração manual num clone novo,
mas errada mesmo assim: segredo real não deveria estar em nenhum arquivo
commitado, "só teste" ou não. Corrigido: a senha do Postgres foi trocada
(o valor antigo, ainda presente no histórico do Git, não serve mais pra
nada), e `.env.test` segue agora a mesma regra do `.env` de dev — nunca
versionado.

### 4.4 Instalação e migrations

```bash
npm install
npx prisma migrate dev
npx prisma generate
```

**O `npx prisma generate` no final não é opcional, mesmo que
`npx prisma migrate dev` já tenha rodado.** Achado ao testar um clone
limpo do zero: nesta versão do Prisma (7.10.0, modo driver adapter),
`migrate dev` aplica as migrations mas **não** gera o Prisma Client
automaticamente — sem o `generate` explícito, `src/generated/prisma`
não existe, e o próximo passo (`npm run start:dev`) quebra na hora com
`ERR_MODULE_NOT_FOUND`. (`npm run build` e `npm run test`/`test:e2e` têm
esse comando embutido como `prebuild`/`pretest:e2e` e funcionariam sem
este passo manual — só `start:dev` não tem esse gancho.)

Depois, semeie o banco de **desenvolvimento** (RBAC + um usuário de cada
papel — sem isso, as credenciais de teste citadas no §4.8 não existem
ainda e o login no Swagger dá `401`):

```bash
npx prisma db seed
```

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

**A suíte assume um banco de teste recém-semeado**: alguns testes fazem
afirmações absolutas sobre o estado do banco (ex.: "existe exatamente 1
ADMIN ativo") que quebram se outro processo (inclusive uma sessão de
auditoria externa) já tiver criado dados no mesmo banco antes. Rode
sempre `npm run db:reset:test` antes de `npm run test:e2e` se a suíte
falhar de um jeito que pareça "número errado" em vez de "comportamento
errado" — é sinal de banco sujo, não de bug de produto (reproduzido e
confirmado 10/10 verde depois do reset).

Requer o `.env.test` criado no passo §4.3 acima, e a migration + seed
aplicados no banco de **teste**:

```bash
npm run db:reset:test
```

Isso derruba e recria só o `recrutamento_test` (nunca toca no
`recrutamento_dev`) e roda o seed em seguida — use sempre que o banco de
teste ficar num estado inconsistente entre execuções (sem esse comando,
um teste interrompido no meio podia deixar dados residuais que quebravam
a próxima rodada de testes).

Internamente é `scripts/db-reset-test.ts` (rodado via `tsx`), não mais o
CLI `dotenv run` direto no `package.json`. **Achado crítico:** a versão
anterior (`dotenv run -f .env.test -- prisma migrate reset --force`) não
sobrescrevia um `DATABASE_URL` já exportado no shell — se alguém tivesse
seguido a "alternativa manual" abaixo (que exporta `DATABASE_URL` na mão)
e depois rodasse `db:reset:test`, o comando apagava **o banco apontado
por essa variável, não o de teste**. Provado com um "banco canário"
descartável. O script novo lê `.env.test` e monta o ambiente do processo
filho com esses valores **sempre por cima** de qualquer coisa já
exportada, e se recusa a rodar se o nome do banco alvo não contiver
`"test"`. Também mantém uma correção anterior: `migrate reset` sozinho,
nesta versão do Prisma, não dispara o seed automaticamente, por isso os
dois comandos continuam explícitos e encadeados dentro do script.

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

**168 testes automatizados, todos verdes** (156 e2e em
`test/app.e2e-spec.ts` + `test/auth.e2e-spec.ts` +
`test/companies.e2e-spec.ts` + `test/company-stats.e2e-spec.ts` +
`test/jobs.e2e-spec.ts` +
`test/candidate-profile.e2e-spec.ts` + `test/applications.e2e-spec.ts` +
`test/interviews.e2e-spec.ts` + `test/documents.e2e-spec.ts` +
`test/users.e2e-spec.ts` + `test/roles.e2e-spec.ts` +
`test/gate-fase3.e2e-spec.ts` + `test/docs.e2e-spec.ts` +
`test/cep.e2e-spec.ts` (14 arquivos), 12 unitários em `src/app.controller.spec.ts` +
`src/common/cep/cep.service.spec.ts` + `src/roles/roles.service.spec.ts` +
`src/common/interceptors/logging.interceptor.spec.ts` +
`src/common/filters/global-exception.filter.spec.ts`), cobrindo os
cenários obrigatórios de auth (400/401/409, fluxo completo de registro/
login/refresh/logout, uma rota protegida por permission key, e a trava de
último administrador sob concorrência real — 8 admins temporários, 4
pares de desativação mútua simultânea, nunca `500`), o CRUD completo de
`Company`/`Job` (403/404/409 com `reason` estruturado, isolamento entre
empresas testado com o usuário real do seed, corrida de transição de
status testada com `Promise.all`), a visibilidade condicional de
`CandidateProfile` (reduzido/completo conforme o status real de uma
`Application`, nunca `403`), a integração externa de CEP funcionando e
falhando de forma controlada (contra o ViaCEP real, sem mock, para os
cenários e2e — o único mock do projeto é o `HttpService` no teste
unitário do `CepService`, pra provocar de forma determinística os três
resultados do contrato discriminado: `ok`/`invalid`/`unavailable`), a
regra obrigatória de candidatura duplicada e vaga inativa
(`test/applications.e2e-spec.ts`), a concorrência real de contratação
(duas `HIRED` simultâneas na última vaga — `Promise.all`, exatamente uma
vence, `reason: "no_vacancies_left"` na outra, nunca `5xx`), o contrato
de `RESCHEDULED` de `Interview` (`201` com a nova entrevista, original
vira `RESCHEDULED`), e o upload de documento com MIME/tamanho inválidos
(`test/documents.e2e-spec.ts`, cenário obrigatório #8). **10 dos 10**
cenários obrigatórios do enunciado cobertos (ver §2.1).

**Achados críticos de concorrência/escopo (Fase 4):** 6 críticos, todos
com teste de reprodução real adicionado — reduzir `vacancies` durante uma
contratação em voo (`filledCount > vacancies` corrigido com SQL
coluna×coluna + `CHECK` novo na migration), duas travas de "último" (RBAC
`role:manage` e ADMIN) furadas por escrita concorrente sem transação
(corrigidas com o mesmo `Serializable` de `deactivate()`), e escopo de
empresa desativada faltando em 3 módulos. `vitest.config.e2e.ts` passou a
rodar arquivos e2e em sequência (`fileParallelism: false`) — necessário
pra testar agregados globais (contagem de admins ativos) sem risco de
interferência entre arquivos.

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

### 4.8 Documentação interativa (Swagger)

Com a API rodando (`npm run start:dev` ou `npm run start:prod`), abra:

```
http://localhost:3000/docs
```

Pública de propósito — não pede `x-api-key` nem login (decisão de
produto, ver `src/common/swagger.config.ts`). Lista
os 43 endpoints em 11 tags em português, com o schema de cada DTO,
todos os códigos HTTP que cada rota realmente retorna, e o botão
**Authorize** pronto pra testar de verdade: cole a `x-api-key` do seu
`.env` no campo `api-key`, e um `accessToken` obtido em `POST /auth/login`
no campo `jwt` (sem o prefixo `Bearer`, o Swagger adiciona sozinho). O
JSON puro da especificação fica em `http://localhost:3000/docs-json`.

Credenciais de teste (seed): `admin@recrutamento.test`,
`recrutador@recrutamento.test`, `candidato@recrutamento.test`, senha
`Senha@123` (ou o valor de `SEED_USER_PASSWORD` no seu `.env`, se tiver
definido um).

### 4.9 Docker + Observabilidade (bônus)

Sobe a API + Postgres + Loki + Promtail + Grafana num único comando,
tudo em containers, isolado do ambiente nativo dos passos 4.1-4.8:

```bash
cp docker/.env.example docker/.env
# edite docker/.env com segredos próprios (nunca reaproveite os do .env nativo)
./docker/compose.sh up -d --build
```

- API (com Swagger): `http://localhost:3001/docs`
- Grafana: `http://localhost:3002` (login: `GRAFANA_ADMIN_USER`/
  `GRAFANA_ADMIN_PASSWORD` do `docker/.env`)

**Importante — leia antes de demonstrar o Grafana ao vivo:** o Grafana
só reflete o tráfego que bate na **API Dockerizada** (`:3001`). A API
nativa do dia a dia (`:3000`, passos 4.1-4.8 acima) não tem nenhum
coletor de log apontado pra ela — não existe hoje um agente rodando no
ambiente nativo enviando log pro Loki. Testar no Swagger da porta `3000`
enquanto se observa o Grafana **não vai aparecer nada** (não é bug, é a
arquitetura: Promtail só lê containers Docker). **Pra qualquer
demonstração ao vivo com Grafana, use sempre o Swagger da porta `3001`
(a instância Docker), não a `3000`.**

Os dois ambientes são independentes: bancos diferentes, seeds diferentes,
`API_KEY`/`JWT_SECRET` diferentes (os do `docker/.env`, não os do `.env`
nativo). Um token/chave gerado num ambiente não funciona no outro.

## 5. Endpoints

Preenchida endpoint por endpoint conforme são implementados. Todas
exigem `x-api-key` (decisão CE-1, sem exceção nenhuma, nem para as rotas
públicas de auth).

| Método | URL | Autenticação/Permissão | Body | Principais respostas |
|---|---|---|---|---|
| `GET` | `/health` | Só API key | — | `200` `{status:"ok",timestamp}` |
| `GET` | `/cep/:cep` | Só API key (rota pública, item além do pedido — §2.3) | — | `200 {street,city,state}`; `400` formato inválido (`reason: "cep_formato_invalido"`) ou CEP inexistente (`reason: "cep_nao_encontrado"`); `502` provedor externo indisponível (`reason: "servico_cep_indisponivel"`, transitório — tente de novo) |
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
| `GET` | `/companies/:id/stats` | JWT + permission `company:read` | — | `200` indicadores de negócio (vagas por status, funil de candidaturas, taxa de conversão, tempo médio até contratação — §2.3); `404` inexistente, inativa, ou (RECRUITER) de outra empresa |
| `POST` | `/jobs` | JWT + permission `job:create` | `{title, description, vacancies, salaryMin?, salaryMax?, isRemote, companyId?}` | `201`; `400` DTO inválido ou `companyId` ausente para ADMIN; `404` `companyId` de outra empresa, inexistente/inativa, ou RECRUITER sem empresa própria |
| `GET` | `/jobs` | Só API key (rota pública) | — (query `?page&limit&search`) | `200` lista só vagas `OPEN` |
| `GET` | `/jobs/mine` | JWT + permission `job:read:any` | — (query `?status&page&limit`) | `200` vagas da própria empresa em qualquer status (ADMIN vê todas) |
| `GET` | `/jobs/:id` | JWT + permission `job:read` | — | `200` se `OPEN`, ou se `job:read:any` + mesma empresa; `404` caso contrário |
| `PATCH` | `/jobs/:id` | JWT + permission `job:update` | `{title?, description?, vacancies?, salaryMin?, salaryMax?, isRemote?}` | `200`; `400` DTO; `404` fora do escopo; `409` `vacancies` abaixo do já preenchido (`reason: "vacancies_below_filled_count"`) |
| `PATCH` | `/jobs/:id/status` | JWT + permission `job:status:update` | `{status}` | `200`; `400` transição inválida (`reason: "invalid_status_transition"`); `404` fora do escopo; `409` `FILLED` sem preencher todas as vagas (`reason: "job_not_fully_filled"`) |
| `GET` | `/candidates/me` | JWT + permission `candidate-profile:read` | — | `200`; `404` perfil ainda não criado |
| `PATCH` | `/candidates/me` | JWT + permission `candidate-profile:update:own` | `{headline?, summary?, phone?, cep?, skills?}` | `200` (upsert — cria na primeira chamada); `400` DTO/CEP |
| `GET` | `/candidates/:userId` | JWT + permission `candidate-profile:read` | — | `200` completo (dono/ADMIN, ou RECRUITER com candidatura em `UNDER_REVIEW`/`INTERVIEW`/`OFFERED`/`HIRED`) ou reduzido (RECRUITER só com candidatura `PENDING`/`REJECTED`/`WITHDRAWN` — lista positiva, não "diferente de `PENDING`"); `404` não é candidato, sem relação, empresa do recrutador desativada, ou fora do escopo |
| `POST` | `/jobs/:jobId/applications` | JWT + permission `application:create` | `{coverLetter?, resumeDocumentId?}` | `201`; `400` DTO/`resumeDocumentId` não pertence a você; `404` vaga inexistente ou empresa inativa; `409` candidatura duplicada (`reason: "candidatura_duplicada"`) ou vaga não `OPEN` (`reason: "job_not_open"`) |
| `GET` | `/applications/me` | JWT + permission `application:read:own` | — (query `?status&page&limit`) | `200` só as do `@CurrentUser()` |
| `GET` | `/jobs/:jobId/applications` | JWT + permission `application:read:job` | — (query `?status&page&limit`) | `200`; `404` vaga fora do escopo (empresa diferente) |
| `GET` | `/applications/:id` | JWT (sem `@Permissions()` — precisa de OU entre `read:own`/`read:job`/`read:any`, decidido no Service) | — | `200` completo (dono/ADMIN, ou recrutador com status `UNDER_REVIEW`+) ou reduzido (recrutador com `PENDING`); `403` nenhuma das 3 keys; `404` fora do escopo |
| `PATCH` | `/applications/:id/status` | JWT + permission `application:status:update` | `{status, reason?}` | `200`; `400` transição inválida; `404` fora do escopo; `409` `HIRED` sem vaga disponível (`reason: "no_vacancies_left"`) ou mudança concorrente (`reason: "application_status_changed_concurrently"`) |
| `PATCH` | `/applications/:id/withdraw` | JWT + permission `application:withdraw:own` | `{reason?}` | `200`; `404` não é o dono; `409` candidatura já em status final (`reason: "application_ja_encerrada"`) |
| `POST` | `/applications/:applicationId/interviews` | JWT + permission `interview:create` | `{scheduledAt, interviewerId?}` | `201`; `400` DTO; `404` candidatura fora do escopo; `409` candidatura não está em `INTERVIEW` (`reason: "application_not_in_interview_stage"`) |
| `GET` | `/applications/:applicationId/interviews` | JWT + permission `interview:read` | — | `200`; `404` fora do escopo |
| `GET` | `/interviews/:id` | JWT + permission `interview:read` | — | `200`; `404` fora do escopo |
| `PATCH` | `/interviews/:id` | JWT + permission `interview:update` | `{status?, feedback?, scheduledAt?}` | `200` (edição normal) ou **`201` com a NOVA entrevista** quando `status: "RESCHEDULED"` (a original vira `RESCHEDULED`); `400` `scheduledAt` ausente no reagendamento; `404` fora do escopo; `409` entrevista já em status final |
| `POST` | `/documents` | JWT + permission `document:upload:own` | `multipart/form-data`: `file` + `type` | `201 {id, filename, mimeType, sizeBytes}`; `400` arquivo ausente (`reason: "arquivo_ausente"`), MIME não permitido (`reason: "mime_type_invalido"`) ou tamanho excedido — 5MB (`reason: "arquivo_excede_tamanho_maximo"`) |
| `GET` | `/documents/me` | JWT + permission `document:read:own` | — | `200` lista os próprios |
| `GET` | `/documents/:id` | JWT (sem `@Permissions()` — OU entre `read:own`/`read:application`) | — | `200` (stream/download); `403` nenhuma das 2 keys; `404` fora do escopo. **Regra exata do `read:application`:** só o documento **anexado como `resumeDocumentId`** de uma candidatura da empresa do recrutador, com status `UNDER_REVIEW`+, libera — não "qualquer documento do candidato" (isso vazava documentos nunca enviados à empresa, ex.: um laudo médico). Efeito colateral aceito conscientemente: `COVER_LETTER`/`CERTIFICATE`/`OTHER` nunca ficam visíveis a recrutador nenhum hoje, porque `Application` só tem um slot de anexo (`resumeDocumentId`) — um modelo de anexos explícito resolveria isso, mas fica registrado como melhoria futura, fora do escopo desta fase. Também: `REJECTED` remove o acesso ao currículo já anexado (mesma minimização de dados do `CandidateProfile`), decisão registrada aqui pra não ser "consertada" como bug depois |
| `GET` | `/users` | JWT + permission `user:read` | — (query `?role&companyId&isActive&page&limit`) | `200` lista paginada |
| `GET` | `/users/:id` | JWT + permission `user:read` | — | `200` (sem `password`); `404` |
| `PATCH` | `/users/:id/company` | JWT + permission `user:manage` | `{companyId: number\|null}` | `200`; `404` usuário/empresa inexistente; `409` alvo não é RECRUITER (`reason: "usuario_nao_e_recrutador"`) |
| `PATCH` | `/users/:id/role` | JWT + permission `user:manage` | `{roleId}` | `200`; `404` usuário/papel inexistente; `409` RECRUITER com vagas ativas (`reason: "recrutador_com_vagas_ativas"`) ou removeria o último ADMIN (`reason: "last_active_admin"`) |
| `GET` | `/roles` | JWT + permission `role:manage` | — | `200` lista com `permissions[]` aninhadas (RBAC Nível B) |
| `GET` | `/roles/:id` | JWT + permission `role:manage` | — | `200`; `404` |
| `PUT` | `/roles/:id/permissions` | JWT + permission `role:manage` | `{permissionIds: number[]}` | `200` substitui o conjunto inteiro (efeito imediato, sem novo login — permissões são recalculadas do banco a cada request); `400` `permissionId` inexistente; `404` papel inexistente; `409` deixaria o sistema sem nenhum papel com `role:manage` (`reason: "sem_papel_com_role_manage"`) **ou** conflito de concorrência (`reason: "concorrencia_transacao"` — a transação `Serializable` que protege isso pode gerar esse `409` em dois `PUT`s simultâneos mesmo em papéis diferentes e sem nenhum dos dois tocar `role:manage`, porque os dois leem o mesmo predicado global; é seguro e retryável, não indica erro do cliente) |

**Nota sobre formato de erro:** a partir de `Companies`, respostas `404`/`409`
de regra de negócio ganham um campo `reason` machine-readable além de
`message` (ex.: `{statusCode: 409, reason: "cnpj_duplicado", message: "..."}`)
— decisão tomada na Fase 2, adotada só para módulos novos. As
rotas de `Auth`/`Users` acima mantêm o formato antigo (sem `reason`), já
validado, para não reabrir escopo fechado. O corpo de erro sempre inclui
o campo `error`, e todo `403` (de qualquer rota protegida por permission
key) ganha `reason: "permission_denied"`.

**Nota sobre `deactivate`/`reactivate`:** originalmente essas rotas
devolviam `204` sem corpo (mesmo padrão de `DELETE`). Revisado depois de
`Company` existir, pensando no frontend: `200` com o recurso atualizado
evita uma chamada `GET` extra só para confirmar `isActive`. Mudança só de
contrato de resposta — a lógica de negócio já validada (trava de último
admin, revogação de refresh tokens, ordem de checagem 404→409) continua
idêntica; verificado reexecutando a suíte completa (`test/auth.e2e-spec.ts`,
incluindo o teste de concorrência de 8 admins, e `test/companies.e2e-spec.ts`).

**Nota sobre transições de status de `Job`:** `DRAFT→{OPEN,CANCELED}`,
`OPEN→{PAUSED,FILLED,CLOSED,CANCELED}`, `PAUSED→{OPEN,CANCELED}`,
`FILLED→CLOSED`; `CLOSED`/`CANCELED` são terminais. `OPEN→CANCELED` foi
uma adição nossa (não estava explícito no fluxo original planejado na
Fase 1) — cancelar uma vaga aberta é uma necessidade óbvia de negócio.
`OPEN→CLOSED` tinha sido removida sem registro numa versão anterior,
contradizendo o comentário do próprio enum em `schema.prisma`
("`CLOSED`: encerrada definitivamente **sem** preencher todas as vagas")
— achado da revisão técnica, reincluída. `DELETE /jobs/:id`
deliberadamente não existe: soft-delete via
`PATCH /jobs/:id/status {status: "CANCELED"}` preserva candidaturas/
entrevistas/documentos vinculados — `job:delete` fica reservada no
catálogo (ADMIN continua com 24 keys), sem rota.

**Nota sobre `company` embutida nas respostas de vaga:** `GET /jobs`,
`GET /jobs/:id` e `GET /jobs/mine` sempre trazem `company: {id, name}` —
antes o candidato via só `companyId` cru, sem nenhuma rota que
resolvesse isso num nome. A listagem pública (`GET /jobs`) usa um
`select` dedicado que **não** inclui `createdById` nem `filledCount`
(nenhum dos dois pertence a uma vitrine pública); as rotas autenticadas
(`/jobs/mine`, `/jobs/:id`) continuam com os campos completos.

**Nota sobre visibilidade pública e empresa desativada:** uma vaga `OPEN`
só é visível publicamente (`GET /jobs` e `GET /jobs/:id` para quem não é
da empresa) se a empresa dona também estiver ativa — antes, desativar
uma empresa não escondia suas vagas já publicadas, e a vitrine chegava a
anunciar uma empresa que `GET /companies/:id` já dizia "não encontrada".
A correção **não** cascateia o status da vaga (isso destruiria
informação que o `reactivate` de empresa não conseguiria desfazer) — só
a visibilidade pública passou a considerar `company.isActive`. O dono
(`job:read:any` + mesma empresa) continua lendo o próprio histórico
normalmente, empresa ativa ou não.

**Nota sobre visibilidade condicional de `CandidateProfile`** (definido
na Fase 1 de planejamento)**:** `GET /candidates/:userId` nunca devolve
`403` — sempre `200` (completo ou reduzido) ou `404`. Um RECRUITER só
enxerga o perfil se existir alguma candidatura do candidato pra uma vaga
da própria empresa (`404` caso contrário, mesma política anti-enumeração
do resto do projeto); enxerga **completo** se alguma candidatura já saiu
de `PENDING` (a empresa já tomou alguma ação), senão só o **reduzido**
(`id`, `name`, `headline`, `skills` — sem `summary`/`phone`/endereço). O
dono e o ADMIN sempre veem completo. `PATCH /candidates/me` é *upsert*
de propósito — não existe `POST` separado, o perfil nasce na primeira
atualização.

## 6. Exemplos de requisição

Entregável explícito do enunciado, além da lista de endpoints do §5.
Cobre o fluxo principal de ponta a ponta — registro → login → empresa →
vaga → candidatura → contratação — mais upload e um erro de cada
categoria (400/401/403/404/409). Substitua `SUA_API_KEY` pelo valor do
seu `.env`; nunca cole a chave real aqui ou em qualquer lugar público
(mesma razão pela qual o `example` do Swagger não usa credenciais reais).

Sobre a senha `SenhaForte@123` nos exemplos de registro abaixo (e na
coleção do Postman, `docs/postman/`): diferente do `example` estático do
Swagger — mostrado a qualquer visitante sem contexto, por isso mascarado
como `********` —, estes são comandos **feitos pra rodar de verdade**, e
por isso precisam de uma string sintaticamente válida. `SenhaForte@123`
não é senha de nenhuma conta real (é sempre usada pra **criar** um
candidato fictício novo, nunca pra logar numa conta existente); a política
de mascarar vale para artefatos estáticos, não para exemplos executáveis.

**1. Registrar um candidato** (`201`, já devolve os tokens):

```bash
curl -X POST http://localhost:3000/auth/register \
  -H "x-api-key: SUA_API_KEY" -H "Content-Type: application/json" \
  -d '{"name":"Maria Silva","email":"maria@example.com","password":"SenhaForte@123"}'
```

**2. Login** (`200`):

```bash
curl -X POST http://localhost:3000/auth/login \
  -H "x-api-key: SUA_API_KEY" -H "Content-Type: application/json" \
  -d '{"email":"admin@recrutamento.test","password":"Senha@123"}'
```

**3. Criar empresa** (ADMIN, `201` — CEP real enriquece o endereço):

```bash
curl -X POST http://localhost:3000/companies \
  -H "x-api-key: SUA_API_KEY" -H "Authorization: Bearer SEU_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Tech Solutions Ltda","cnpj":"12.345.678/0001-90","cep":"01310-100"}'
```

**4. Criar vaga** (RECRUITER, `201`):

```bash
curl -X POST http://localhost:3000/jobs \
  -H "x-api-key: SUA_API_KEY" -H "Authorization: Bearer SEU_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"Desenvolvedor(a) Backend Node.js","description":"Vaga remota, foco em NestJS.","vacancies":2,"isRemote":true}'
```

**5. Candidatar-se a uma vaga** (CANDIDATE, `201`):

```bash
curl -X POST http://localhost:3000/jobs/1/applications \
  -H "x-api-key: SUA_API_KEY" -H "Authorization: Bearer SEU_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"coverLetter":"Tenho 3 anos de experiência com Node.js e NestJS."}'
```

**6. Avançar/contratar candidatura** (RECRUITER, `200`):

```bash
curl -X PATCH http://localhost:3000/applications/1/status \
  -H "x-api-key: SUA_API_KEY" -H "Authorization: Bearer SEU_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status":"UNDER_REVIEW"}'
```

**7. Upload de documento** (CANDIDATE, multipart, `201`):

```bash
curl -X POST http://localhost:3000/documents \
  -H "x-api-key: SUA_API_KEY" -H "Authorization: Bearer SEU_TOKEN" \
  -F "type=RESUME" -F "file=@curriculo.pdf;type=application/pdf"
```

**8. Indicadores de negócio da empresa** (RECRUITER/ADMIN, `200`):

```bash
curl http://localhost:3000/companies/1/stats \
  -H "x-api-key: SUA_API_KEY" -H "Authorization: Bearer SEU_TOKEN"
```

**Um exemplo de cada erro obrigatório do enunciado** (cenários #2-#7 do
§2.1):

```bash
# 400 — body inválido (email mal formado)
curl -X POST http://localhost:3000/auth/register -H "x-api-key: SUA_API_KEY" \
  -H "Content-Type: application/json" -d '{"name":"X","email":"não-é-email","password":"123"}'
# -> {"message":["email must be an email", ...],"error":"Bad Request","statusCode":400}

# 401 — sem x-api-key
curl http://localhost:3000/health
# -> {"statusCode":401,"error":"Unauthorized","message":"API key ausente ou inválida."}

# 403 — autenticado, sem a permission key da rota
curl http://localhost:3000/users -H "x-api-key: SUA_API_KEY" -H "Authorization: Bearer TOKEN_DE_CANDIDATE"
# -> {"statusCode":403,"error":"Forbidden","reason":"permission_denied","message":"..."}

# 404 — recurso inexistente
curl http://localhost:3000/companies/999999 -H "x-api-key: SUA_API_KEY" -H "Authorization: Bearer SEU_TOKEN"
# -> {"statusCode":404,"error":"Not Found","reason":"company_not_found","message":"Empresa não encontrada."}

# 409 — conflito de regra de negócio (candidatura duplicada)
curl -X POST http://localhost:3000/jobs/1/applications -H "x-api-key: SUA_API_KEY" \
  -H "Authorization: Bearer TOKEN_DE_CANDIDATE" -H "Content-Type: application/json" -d '{}'
# (repetindo a mesma chamada) -> {"statusCode":409,"error":"Conflict","reason":"candidatura_duplicada","message":"..."}
```
