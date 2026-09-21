# Plataforma de Recrutamento — API (AV-04)

> **Status atual: Fase 1 — Fundamentação e Modelagem, aguardando validação
> externa (Qwen/DevSecOps e DeepSeek/Negócio).** Nenhum endpoint foi
> implementado ainda. Este README será atualizado a cada fase concluída —
> ele é o documento histórico da avaliação, não uma tarefa de última hora.

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
| Modelagem Prisma com relacionamentos, constraints, enums | 🟡 Proposto (`prisma/schema.prisma`), aguardando validação |
| Autenticação JWT + `@CurrentUser()` | ⬜ Não iniciado |
| Autorização por papel (CANDIDATE/RECRUITER/ADMIN) | ⬜ Não iniciado |
| CRUDs / gestão das entidades | ⬜ Não iniciado |
| Consultas por relacionamento | ⬜ Não iniciado |
| Fluxo de estados do domínio (Job, Application, Interview) | 🟡 Desenhado (`docs/fases/FASE-1-MODELAGEM.md`), não implementado |
| Upload de currículo/documento | ⬜ Não iniciado |
| Integração externa via `HttpService` (CEP/localização) | ⬜ Não iniciado |
| Interceptor coerente | ⬜ Não iniciado |
| Helmet + Compression | ⬜ Não iniciado |
| Tratamento de 400/401/403/404/409 | ⬜ Não iniciado |
| Build de produção sem erros | ⬜ Não iniciado |
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

_(preencher conforme decisões forem tomadas — ex.: rate limiting em login,
se for adiado, deve aparecer aqui com justificativa, não silenciado)._

## 3. Como este projeto foi conduzido

Cada fase tem um documento em `docs/fases/` com: a modelagem/decisão
proposta, o motivo (\"porquê\", não só \"o quê\"), e o veredito das revisões
externas antes de avançar para a próxima fase. Ver `docs/fases/FASE-1-MODELAGEM.md`.

## 4. Instalação e execução

_(Esta seção só será preenchida com passos reais e testados à medida que
cada peça existir — instalação, `.env`, migrations, seed, dev, build,
Docker/observabilidade. Nenhum passo é escrito aqui antes de ter sido
executado de fato.)_

## 5. Endpoints

_(Tabela método/URL/autenticação/body/respostas será preenchida a partir da
Fase 2, endpoint por endpoint, nunca em lote no final.)_
