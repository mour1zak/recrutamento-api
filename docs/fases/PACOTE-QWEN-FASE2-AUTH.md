# Pacote para revisão — Qwen (QA Lead & DevSecOps) — Fase 2: Módulo de Auth

Cole este documento inteiro na conversa com o Qwen.

---

Você é o **QA Lead / DevSecOps Specialist** do projeto `recrutamento-api`.
Na rodada 3 (Fase 1), você aprovou o schema com ressalvas e definiu um
checklist de "Gate Fase 2, Passo 1" em `PARECER-QWEN-FASE1-RODADA3.md`.
Esta é a primeira revisão de **código de aplicação** (não mais só schema) —
o módulo de autenticação + RBAC dinâmico + a decisão CE-1 (API key global)
foram implementados. Peço que audite especificamente contra o checklist que
você mesmo definiu, e qualquer coisa nova que encontrar no código real.

## O que foi implementado (commit mais recente da branch `main`)

- `src/common/constants/permissions.constants.ts` — catálogo de 28
  permission keys, fonte única (CE-2). Correção que apliquei: ADMIN recebe
  **24** keys (28 menos as 4 exclusivas de candidato), não 28 como o
  parecer do DeepSeek somava de forma inconsistente com sua própria lista
  de exceções.
- `src/common/guards/api-key.guard.ts` — `ApiKeyGuard` global (`APP_GUARD`),
  decisão CE-1 (consumidor sempre confiável, sem rotas isentas). Comparação
  em tempo constante via hash SHA-256 + `timingSafeEqual`.
- `src/common/guards/permissions.guard.ts` — `PermissionsGuard` global,
  no-op sem `@Permissions()`, 403 quando falta a key.
- `src/common/utils/password.util.ts` — `hashPassword`/`verifyPassword`:
  pré-hash SHA-256 antes do bcrypt.
- `src/auth/` — `AuthModule`, `AuthService` (register/login/refresh com
  rotação/logout), `AuthController`, `JwtStrategy` (revalida no banco a
  cada request, não confia em papel/permissão embutidos no JWT).
- `src/users/users.service.ts` — `deactivate()` implementa R-C4.1 (revoga
  refresh tokens ativos); `createCandidate()` normaliza email, resolve
  papel CANDIDATE por nome.
- `prisma/seed.ts` — popula RBAC + 1 usuário por papel.

## Achado que eu mesmo encontrei e corrigi (registro de honestidade)

Primeira versão usava `@MaxLength(72)` na senha, pensando em alinhar com o
limite do bcrypt. Um usuário do time notou que isso "parecia um número alto
e estranho pra senha" — ao investigar, achei que `@MaxLength` conta
**caracteres**, não **bytes**, e o bcrypt trunca em **72 bytes**. Uma senha
com acentuação (comum em português) pode ter mais bytes que caracteres,
então a proteção original nem funcionava para esse caso. Corrigido
eliminando o limite pela raiz: pré-hash SHA-256 antes do bcrypt
(`password.util.ts`), removendo o truncamento por completo, para qualquer
idioma/tamanho. Provado com senha de 80+ caracteres acentuados: senha
completa → login `200`; só o prefixo de ~72 bytes → `401`.

## Evidência de teste (manual, via curl — ainda não é suíte automatizada)

| Cenário | Resultado |
|---|---|
| Sem API key / API key errada | `401` |
| Registro válido | `201`, sem senha na resposta |
| Login válido / senha errada | `200` / `401` genérico (não revela qual campo errou) |
| Registro com email duplicado | `409` |
| Body inválido | `400` |
| Refresh válido → rotação → reuso do token antigo | `200` → `401` no reuso |
| Logout sem JWT / JWT inválido / JWT válido | `401` / `401` / `204` |
| Refresh após logout | `401` |
| Senha longa acentuada, completa vs. truncada | `200` / `401` |

## Checklist "Gate Fase 2, Passo 1" (da sua rodada 3) — minha autoavaliação, peça pra confirmar

- [x] Toolchain versionado (`package.json`, `tsconfig.json`,
      `prisma.config.ts`, `.env.example`)
- [x] `generator` com `moduleFormat`/`importFileExtension` explícitos
- [x] `omit` global no `PrismaService`
- [x] Catálogo de permissões em fonte única (CE-2)
- [x] R-C4.1 implementado e testado (desativação revoga refresh tokens)
- [x] CE-1 decidido e implementado (API key global, sem rotas isentas)

## Perguntas específicas para esta rodada

1. O padrão de refresh token (aleatório de 48 bytes + hash SHA-256
   determinístico pra busca no banco, com rotação a cada uso) está
   correto? SHA-256 sem "pepper"/segredo do servidor é suficiente aqui, ou
   deveria ser HMAC-SHA256 com uma chave do servidor?
2. `ApiKeyGuard` e `PermissionsGuard` como `APP_GUARD` globais, na ordem
   `[ApiKeyGuard, PermissionsGuard]` — essa ordem está certa? O
   `PermissionsGuard` roda antes do `JwtAuthGuard` (que não é global, só
   por controller) em rotas protegidas — isso é um problema? (Hoje nenhuma
   rota real usa `@Permissions()` ainda, só `AuthController`, que não usa,
   então na prática não foi exercitado.)
3. Existe algum vazamento de dado sensível nas respostas do `AuthController`
   que eu não vi? (`toPublicUser()` só expõe id/name/email/role.)
4. `bcryptjs` (puro JS) em vez do `bcrypt` nativo — troquei porque o script
   de instalação nativo foi bloqueado pelo `npm`. Isso tem alguma
   implicação de segurança ou performance que deveria pesar mais na
   decisão?
5. Alguma lacuna no fluxo de `register`/`login`/`refresh`/`logout` frente
   aos 10 cenários obrigatórios do enunciado que ainda não apareceu nos
   meus testes manuais?

## O que eu preciso de volta

Mesmo formato de sempre: veredito (aprovado/aprovado com ressalvas/
reprovado), itens críticos, ressalvas, sugestões — mas desta vez sobre
**código**, não schema.
