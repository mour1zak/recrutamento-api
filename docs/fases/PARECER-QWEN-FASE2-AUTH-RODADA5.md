# Parecer — Qwen (QA Lead & DevSecOps) — Fase 2: Auth, Rodada 5

> Registro do retorno recebido em resposta ao `PACOTE-QWEN-FASE2-AUTH.md`
> (rodada 5). Condensado mas fiel ao original (relatório completo anexado
> pelo usuário, `RELATORIO-QWEN-FASE2-AUTH-RODADA5.md`). Triagem em
> `TRIAGEM-REVISOES-RODADA5.md`.

**Veredito: APROVADO COM RESSALVAS.** Os 5 críticos e as 2 ressalvas
obrigatórias da rodada 4 foram reexecutados (não só lidos) contra um
PostgreSQL real, com carga **maior** que a nossa (20 refreshes concorrentes
contra os 10 que testamos; 10 registros concorrentes contra os 5 que
testamos) — todos fecharam. Uma retratação de honestidade do próprio Qwen:
concluiu provisoriamente que `@nestjs/config` ignorava `process.env`, e
corrigiu depois de descobrir que era um artefato do client Prisma apagado
mascarando o teste.

## Falha crítica nova — bloqueia o fechamento da Fase 2

**N1 — o último ADMIN consegue se autodesativar** (`PATCH
/users/:id/deactivate`, sobre a própria conta) **e não existe rota de
reativação.** Reproduzido: admin desativa a si mesmo → `204` → zero admins
ativos → login do admin → `401` → `PATCH /users/:id/activate` → `404`
(rota não existe) → sistema continua aceitando `POST /auth/register` mas
sem nenhum caminho de reversão via API. A trava de "último administrador"
tinha sido adiada para o Nível B nas rodadas 1–3, sob a premissa de que sem
endpoint de edição de permissões o risco não era alcançável — o C5 da
rodada 4 criou exatamente o endpoint (Nível A) que tornou isso alcançável.

## Ressalvas obrigatórias para fechar a Fase 2

- **N2** — `PrismaExceptionFilter`: `meta.target` não existe no Prisma 7
  com driver adapter (o nome da constraint vive em
  `meta.driverAdapterError.cause.constraint.index`); mensagem do 409
  sempre caía no fallback genérico "valor único".
- **N3** — `default` do filtro classificava qualquer código não mapeado
  (inclusive `P1xxx`, erro de infraestrutura) como `409`, levando o
  cliente a tentar de novo contra um banco fora do ar.

## Ressalvas menores (16 itens, N4–N16 no relatório original)

Destaques: `.env.test` versionado passa na validação de boot fora de
`NODE_ENV=test` (N4); suíte e2e não roda em clone fresco por falta de
`pretest:e2e` (N5); `DATABASE_URL` é obrigatório mesmo só para `prisma
generate`, mas isso não estava documentado (N6); mensagem de validação
customizada do Joi não renderizava (N7); rate limiting ausente, agora com
número medido — 30 logins simultâneos, zero `429` (N9); `/health` não
verifica nada de verdade (N10); README §5 (Endpoints) vazio com 5 rotas já
reais (N11); lint já apontava o `roleName: SystemRoleName | string`
redundante (N12); `as PermissionKey` sem validação (N13); `WWW-Authenticate`
ausente (N14); pool do `pg` sem configuração, vai custar um diagnóstico
confuso na Fase 3 (N15); senha do seed de teste pública sem
`SEED_USER_PASSWORD` definida no `.env.test` (N16).

## O que está bom (sustenta a aprovação)

Todas as 5 correções críticas verificadas por execução com carga maior que
a nossa. Correção do timing de login foi além do pedido (78,1ms × 77,3ms,
razão 1,01×). `omit` global com override pontual continua sendo "a melhor
decisão de segurança do projeto". `createCandidate` sem check-then-create
"removeu a janela em vez de protegê-la". `PrismaExceptionFilter` já cobre
`P2034`/`P2028` — antecipação correta para a Fase 3. `TRIAGEM-REVISOES-
RODADA4.md` + `FEEDBACKS-MELHORIA.md` chamados de "o ativo de processo
mais valioso do projeto".

## Condições

**Para fechar a Fase 2:** N1 (inegociável — estado irrecuperável pela
própria API), N2, N3. **Antes da Fase 3:** N9, N15, N5+N6. **Antes da Fase
5:** N4, N7, N10–N14, N16.
