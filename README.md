# Plataforma de Recrutamento — API (AV-04)

> **Status atual: Fase 2, Passo 1 (scaffolding) concluído.** Fase 1 aprovada
> com ressalvas pelo Qwen (rodada 3) — ver `docs/fases/`. NestJS + Prisma
> 7.10.0 + PostgreSQL já conectam e o build de produção já funciona; nenhum
> endpoint de negócio (auth, CRUDs) foi implementado ainda. Este README é
> atualizado a cada fase concluída — documento histórico da avaliação, não
> tarefa de última hora.

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
| Autenticação JWT + `@CurrentUser()` | ⬜ Não iniciado |
| Autorização por papel (CANDIDATE/RECRUITER/ADMIN) | ⬜ Não iniciado |
| CRUDs / gestão das entidades | ⬜ Não iniciado |
| Consultas por relacionamento | ⬜ Não iniciado |
| Fluxo de estados do domínio (Job, Application, Interview) | 🟡 Desenhado (`docs/fases/FASE-1-MODELAGEM.md`), não implementado |
| Upload de currículo/documento | ⬜ Não iniciado |
| Integração externa via `HttpService` (CEP/localização) | ⬜ Não iniciado |
| Interceptor coerente | ⬜ Não iniciado |
| Helmet + Compression | 🟢 Concluído (`src/main.ts`) |
| Tratamento de 400/401/403/404/409 | ⬜ Não iniciado |
| Build de produção sem erros | 🟢 Concluído (`npm run build` verificado) |
| Testes obrigatórios (10 cenários do enunciado) | ⬜ Não iniciado |

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

```bash
npm test        # unitários
npm run test:e2e
```

_(Suíte de testes ainda não escrita — comandos existem e funcionam, mas
sem specs de negócio até a Fase 2/5.)_

## 5. Endpoints

_(Tabela método/URL/autenticação/body/respostas será preenchida a partir da
Fase 2, endpoint por endpoint, nunca em lote no final.)_
