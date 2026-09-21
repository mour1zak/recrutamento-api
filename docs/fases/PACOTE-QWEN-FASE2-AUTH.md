# Pacote para revisão — Qwen (QA Lead & DevSecOps) — Fase 2: Auth, Rodada 5

Cole este documento inteiro na conversa com o Qwen.

---

Você é o **QA Lead / DevSecOps Specialist** do projeto `recrutamento-api`.
Na rodada 4, você reprovou o módulo de auth com **5 achados críticos
reproduzidos por execução** (forjar JWT com o segredo do `.env.example`,
ordem de guards quebrada, suíte e2e vermelha, rotação de refresh não
atômica, `deactivate()` sem chamador) + 2 ressalvas obrigatórias (filtro
global de exceções, seed com credencial exposta). Relatório completo em
`PARECER-QWEN-FASE2-AUTH-RODADA4.md`; nossa resposta item a item em
`TRIAGEM-REVISOES-RODADA4.md`. Esta é a reapresentação.

## O que foi corrigido (todos os 5 críticos + as 2 ressalvas obrigatórias)

| Achado | Correção | Como validamos |
|---|---|---|
| **C1** — JWT forjável com segredo do `.env.example` | `src/config/env.validation.ts` (Joi): boot recusado se `JWT_SECRET`/`API_KEY` forem os placeholders ou iguais entre si | Boot com o placeholder → crash controlado, antes de qualquer rota existir |
| **C2** — `PermissionsGuard` rodava antes do `JwtAuthGuard` | `JwtAuthGuard` virou global (`APP_GUARD`), ordem `[ApiKeyGuard, JwtAuthGuard, PermissionsGuard]`; `@Public()` isenta as rotas de auth | Rota real (`PATCH /users/:id/deactivate`, `user:manage`): candidato → `403`; admin → passa da checagem |
| **C3** — suíte e2e vermelha, README mentindo | `test/app.e2e-spec.ts` corrigido (`/health` + `x-api-key`); `test/auth.e2e-spec.ts` novo; `.env.test` passou a ser **versionado** (segredos dedicados só de teste, nunca reaproveitados) | `npm test` + `npm run test:e2e`: **12 testes, todos verdes**, confirmados isolados e em conjunto |
| **C4** — rotação de refresh não atômica | `updateMany({ where: { id, revokedAt: null } })` checando `count === 1` | 10 refreshes simultâneos com o mesmo token → exatamente **1** sucesso, 9×`401` |
| **C5** — `deactivate()` sem chamador | `UsersController` novo, `PATCH /users/:id/deactivate` protegido por `user:manage` | Desativa de verdade; login do usuário desativado → `401` |
| **R1** — erro do Prisma virava 500 | `PrismaExceptionFilter` (`APP_FILTER`): `P2002`→409, `P2025`→404, `P2003`→400 | 5 registros simultâneos, mesmo email → 1×201, 4×409, zero 500 |
| **R4** — seed com senha hardcoded/logada | Senha via `SEED_USER_PASSWORD` (nunca impressa); seed recusa `NODE_ENV=production` | — |

## Extras aplicados no caminho (não eram obrigatórios pra reapresentação)

- Equalização de tempo de login (`DUMMY_PASSWORD_HASH`) — fecha a enumeração de conta por timing que você mediu (P4, ~72ms vs ~0ms).
- `@MaxLength(256)` no `RefreshTokenDto` (P1).
- `"engines": { "node": ">=22" }` + `"prebuild": "prisma generate"` no `package.json` — testado com `src/generated/` apagado, build funciona sem banco vivo (R8).
- `GET /` virou `GET /health` (R15).
- `permissions.map(...)` trocou `as never` por `as PermissionKey` (parte do R7).
- Comentário do `APIKEY_MANAGE` marcando como reserva (R12).
- Correção do número (49→45) registrada no topo de `PARECER-DEEPSEEK-FASE1.md`, sem editar o texto original (R14).

## Adiado conscientemente (registrado, não escondido)

`FEEDBACKS-MELHORIA.md` ganhou 4 itens novos: `crypto.scrypt` no lugar de
`bcryptjs` (sua sugestão estrutural — concordamos, mas exige migração de
senhas existentes), `familyId` em `RefreshToken` para detecção de reuso
(seu C4, nota complementar), seed derivar de `PERMISSIONS` em vez de
`ROLE_PERMISSIONS` (R11), e CI mínimo (sua sugestão #4). Rate limiting em
`/auth/login` (R3) continua pendente, já registrado desde a Fase 1.
`WWW-Authenticate` no `401` também não foi adicionado ainda.

## O que eu preciso de volta

Mesmo formato: veredito, itens críticos (se algum dos 5 não fechou de
verdade), ressalvas, sugestões. Peço em particular que reexecute os testes
de concorrência (C4) e o teste de bypass (C1) — não só leia o código —
já que foi assim que os achados desta rodada apareceram.
