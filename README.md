# Plataforma de Recrutamento — API (AV-04)

> **Status atual: Fase 2 (Auth/RBAC) fechada na Rodada 6 pelo Qwen**
> (APROVADO COM RESSALVAS) — ver `docs/fases/`. Rodada 7 já reenviada,
> aguardando retorno. Auth completo (registro/login/refresh/logout),
> RBAC dinâmico funcionando de ponta a ponta, filtro global de exceções,
> 15 testes automatizados verdes. O DeepSeek já entregou o mapa dos 41
> endpoints do restante do domínio (Company/Job/Application/
> CandidateProfile/Interview/Document/Users/RBAC Nível B) — implementação
> ainda não iniciada. Este README é atualizado a cada fase concluída —
> documento histórico da avaliação, não tarefa de última hora.

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
| CRUDs / gestão das entidades | 🟡 Só `PATCH /users/:id/deactivate` existe até aqui; demais entidades ainda não |
| Consultas por relacionamento | ⬜ Não iniciado |
| Fluxo de estados do domínio (Job, Application, Interview) | 🟡 Desenhado (`docs/fases/FASE-1-MODELAGEM.md`), não implementado |
| Upload de currículo/documento | ⬜ Não iniciado |
| Integração externa via `HttpService` (CEP/localização) | ⬜ Não iniciado |
| Interceptor coerente | ⬜ Não iniciado |
| Helmet + Compression | 🟢 Concluído (`src/main.ts`) |
| Tratamento de 400/401/403/404/409 | 🟢 Todos os 5 demonstrados por teste automatizado: 400 (DTO inválido), 401 (API key/JWT ausente ou inválido), 403 (permission key ausente), 404 (recurso inexistente), 409 (email duplicado, inclusive sob concorrência) |
| Build de produção sem erros | 🟢 Concluído (`npm run build` verificado) |
| Testes obrigatórios (10 cenários do enunciado) | 🟡 3 de 10 cobertos por teste automatizado (fluxo com sucesso, body inválido, ausência/token inválido, conflito de negócio — via `test/auth.e2e-spec.ts`); os demais (403/404 de terceiro, upload, integração externa, mudança de estado) dependem de módulos ainda não implementados |

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
deixar dados residuais que quebravam a próxima rodada). Internamente é
`prisma migrate reset --force` + `prisma db seed`, ambos carregando
`.env.test` via o CLI do pacote `dotenv` já instalado — **medido por
execução:** `migrate reset` sozinho, nesta versão do Prisma, não dispara
o seed automaticamente (ao contrário do que a documentação de versões
anteriores sugere), por isso os dois comandos são explícitos e
encadeados.

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
e o teste não enviava a chave). Hoje: **15 testes automatizados, todos
verdes** (14 e2e em `test/app.e2e-spec.ts` + `test/auth.e2e-spec.ts`, 1
unitário em `src/app.controller.spec.ts`), cobrindo os cenários
obrigatórios de auth (400/401/409, fluxo completo de registro/login/
refresh/logout, uma rota protegida por permission key, e a trava de
último administrador sob concorrência real — 8 admins temporários, 4
pares de desativação mútua simultânea, nunca `500`). Os demais dos 10
cenários do enunciado (403/404 de dono de recurso, upload, integração
externa, mudança de estado) só têm onde morar quando os módulos
correspondentes existirem.

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
| `PATCH` | `/users/:id/deactivate` | JWT + permission `user:manage` | — | `204`; `403` sem a permissão; `404` usuário inexistente; `409` alvo é a própria conta, o último ADMIN ativo, ou conflito de concorrência (tente novamente) |
| `PATCH` | `/users/:id/reactivate` | JWT + permission `user:manage` | — | `204` (idempotente); `403` sem a permissão; `404` usuário inexistente |
