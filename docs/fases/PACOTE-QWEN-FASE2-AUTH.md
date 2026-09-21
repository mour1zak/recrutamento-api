# Pacote para revisão — Qwen (QA Lead & DevSecOps) — Fase 2: Auth, Rodada 6

Cole este documento inteiro na conversa com o Qwen.

---

Você é o **QA Lead / DevSecOps Specialist** do projeto `recrutamento-api`.
Na rodada 5, você aprovou com ressalvas, mas achou **1 crítico novo**
("inegociável"): o último ADMIN conseguia se autodesativar via `PATCH
/users/:id/deactivate`, sem nenhuma rota de reversão — estado
irrecuperável pela própria API. Também pediu 2 ressalvas obrigatórias
fechadas (mensagem do 409, classificação de erro de infraestrutura).
Relatório completo em `PARECER-QWEN-FASE2-AUTH-RODADA5.md`; nossa resposta
em `TRIAGEM-REVISOES-RODADA5.md`. Esta é a reapresentação.

## O que foi corrigido nesta rodada

| Achado | Correção | Como validamos |
|---|---|---|
| **N1** (crítico, inegociável) — último ADMIN se autodesativa, sem volta | `UsersService.deactivate()` recebe `currentUserId`; recusa (`409`) autodesativação; recusa (`409`) desativar o último ADMIN ativo. As duas checagens rodam dentro de `$transaction(..., { isolationLevel: 'Serializable' })` — evita a mesma classe de corrida do C4, agora aplicada a "contagem de admins ativos" | Autodesativação → `409`; 2 admins se desativando **simultaneamente** → 1 sucesso, o outro barrado (defesa em duas camadas: JWT + transação); **2 testes e2e novos** cobrindo os dois casos, um deles simulando via Prisma um cenário de Nível B futuro (outro papel com `user:manage`) para provar que a trava é por "número de admins ativos", não por "quem está chamando" |
| **N2** — `meta.target` não existe no Prisma 7 com driver adapter | Leitura correta em `meta.driverAdapterError.cause.constraint.index`, dicionário `CONSTRAINT_LABELS` com os 10 constraints reais da migration | Cadastro duplicado → `"Já existe um registro com o mesmo valor em: email."` (antes: `"valor único"`) |
| **N3** — erro de infraestrutura virava `409` | `P1xxx` → `503`; `default` → `500` honesto | — |

## Ressalvas menores também fechadas nesta rodada

N5 (`pretest:e2e: prisma generate`), N7 (mensagem custom do Joi via
`helpers.message()`, não `helpers.error()`), N11 (README §5 preenchido com
as 5 rotas reais), N12 (`SystemRoleName | (string & {})`, corrige o aviso
do lint sem apagar a checagem), N13 (permissions filtradas contra o
catálogo, com log de aviso pra key órfã), N14 (`WWW-Authenticate: Bearer`
em todo `401`, via `UnauthorizedExceptionFilter` novo), N4 (`.env.test`
só passa na validação quando `NODE_ENV=test`, via `Joi.when()`).

## Adiado conscientemente (sem mudança desde a rodada 5)

N6 (nota de documentação, feita), N9 (rate limiting), N10 (`/health`
sem verificação real — decisão CE-1 mantida), N15 (pool do `pg`), N16
(senha do seed de teste pública) — todos registrados em
`CONDICOES-ENTRADA-FASE2.md`/`FEEDBACKS-MELHORIA.md` com destino definido.

## Observação de transparência

Ao corrigir o N4 (Joi `.when()`), o `oxlint` passou a apontar um
falso-positivo (`unicorn/no-thenable`, confundindo as chaves `then`/
`otherwise` da API do Joi com uma Promise). Tentamos comentário de
`disable` em duas sintaxes sem sucesso — documentado como falso-positivo
conhecido no código; não bloqueia build nem testes.

## O que eu preciso de volta

Mesmo formato de sempre. Peço em particular que teste a trava de último
admin sob concorrência real (não só os dois testes e2e que escrevemos) —
é exatamente o tipo de invariante que você já provou, duas vezes nesse
projeto, que merece ser verificada por execução adversarial, não só leitura.
