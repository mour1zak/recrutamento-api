# Pacote para revisão — Qwen (QA Lead & DevSecOps) — Fase 2: Auth, Rodada 7

Cole este documento inteiro na conversa com o Qwen.

---

Você é o **QA Lead / DevSecOps Specialist** do projeto `recrutamento-api`.
Na rodada 6, você aprovou com ressalvas, mas achou **1 crítico novo**: a
trava de último administrador (aprovada na rodada 5) se sustentava sob
carga, mas o conflito de transação `Serializable` que ela produz virava
`500` cru em 67% das corridas concorrentes, porque o driver adapter do
Prisma 7 não entrega esse erro no formato (`P2034`) que o filtro antigo
reconhecia. Também achou um bloqueante de infraestrutura (`prisma
generate` falhando sem `DATABASE_URL` em clone novo/CI) e 4 ressalvas de
custo baixo. Relatório completo em
`PARECER-QWEN-FASE2-AUTH-RODADA6.md`; nossa resposta em
`TRIAGEM-REVISOES-RODADA6.md`. Esta é a reapresentação.

## O que foi corrigido nesta rodada

| Achado | Correção | Como validamos |
|---|---|---|
| **N1-a** (crítico) — conflito `Serializable` vira `500` em 67% das corridas | Os dois filtros de exceção separados foram substituídos por um único `src/common/filters/global-exception.filter.ts`, com um checador de duck-typing (`cause.kind === 'TransactionWriteConflict' \|\| cause.originalCode === '40001'`) rodando **antes** de qualquer outra checagem, devolvendo `409` | Teste e2e novo: 8 admins temporários, 4 pares de desativação mútua simultânea via `Promise.all` — rodado **3× consecutivas**, `14/14` verdes, zero `500` observado |
| **N5-a** (bloqueante) — `prisma generate` falha sem `DATABASE_URL` | `prisma.config.ts`: `env('DATABASE_URL')` estrito trocado por `process.env.DATABASE_URL ?? '<placeholder>'` — `generate` não conecta em banco nenhum | `.env` movido pra fora do diretório inteiro, `npx prisma generate` confirmado funcionando mesmo assim |
| **N1-c** — sem rota de reativação | `UsersService.reactivate()` + `PATCH /users/:id/reactivate` (mesma permissão `user:manage`, idempotente, sem trava especial — reativar nunca zera admins) | `204` em usuário desativado e em usuário já ativo; `404` em usuário inexistente |
| **N1-d** — comentário de `deactivate()` descrevia mecanismo errado | Reescrito para descrever o mecanismo real (`DriverAdapterError`) e documentar a decisão de manter `Serializable` (N1-b) | Revisão de código |
| **#7** — corpo do `401` inconsistente entre rotas | Absorvido pelo filtro unificado: toda `UnauthorizedException` extrai a mensagem original, seta `WWW-Authenticate: Bearer`, formato único | `curl -i` em duas rotas 401 diferentes, mesmo formato de corpo |
| **#8** — comentário `oxlint-disable` inline não suprimia o aviso | `.oxlintrc.json` → `"overrides"` mirando só `env.validation.ts`, desligando `unicorn/no-thenable` ali | `npm run lint` limpo |
| **#10** — key de permissão órfã loga aviso a cada request | `Set` a nível de módulo (`WARNED_ORPHAN_KEYS`) — loga uma vez por processo, não por request | Revisão de código |
| **#11** — mensagem genérica do `P2025` | Já coberto pelo `MODEL_LABELS` do mesmo filtro unificado (`User` → "Usuário", etc.) | Revisão de código |
| **#9** — suíte e2e não reentrante | `npm run db:reset:test` novo (`prisma migrate reset --force` + `prisma db seed`, `.env.test` via `dotenv` CLI) | Rodado de verdade: reset + reseed do `recrutamento_test`, confirmado via query direta (0 roles/users antes do seed, populados depois), e os 14 e2e rodados de novo logo em seguida — todos verdes |

## Adiado conscientemente (registrado, sem mudança de destino)

**N1-b** (decisão de desenho: mantido `Serializable` em vez de `UPDATE`
condicional — a invariante depende de um agregado sobre múltiplas linhas,
diferente do caso de uma linha só). N9 (rate limiting), N15 (pool do
`pg`) — ambos continuam registrados como pré-requisito antes da Fase 3
em `CONDICOES-ENTRADA-FASE2.md`/`FEEDBACKS-MELHORIA.md`.

## Observação de transparência

Ao validar `db:reset:test` por execução real, descobrimos (não estava no
seu relatório) que `prisma migrate reset`, nesta versão do Prisma, **não
dispara o seed automaticamente** — só existe um ponto de chamada do seed
runner no código-fonte do CLI, ligado ao comando `db seed`, não ao
`reset`. Corrigido encadeando os dois comandos explicitamente no script,
em vez de depender do comportamento "reset já vem com seed" que
versões/documentações antigas do Prisma sugerem.

## O que eu preciso de volta

Mesmo formato de sempre. Peço em particular que confirme, sob a mesma
carga adversarial de antes (ou maior), que o conflito de transação agora
sai como `409` e nunca mais como `500` — e que valide se restou algum
outro erro do driver adapter (fora do `TransactionWriteConflict`) que
ainda não tenha formato reconhecido pelo filtro.
