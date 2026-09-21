# Condições de Entrada — Fase 2

Checklist de aceite construído a partir do parecer do Qwen (rodada 3,
`PARECER-QWEN-FASE1-RODADA3.md`) e do DeepSeek. Existe para que nenhuma
exigência vire "promessa esquecida" — o próprio Qwen citou isso como risco.
Marcar conforme for implementado; não avançar para os itens de "Gate Fase 3"
sem os de "Passo 1" resolvidos.

## Adendo rodada 4 (auditoria de código, não mais só schema) — REPROVADO → corrigido

O primeiro código de aplicação auditado (módulo de auth) trouxe 5 achados
críticos reproduzidos por execução real — ver
`PARECER-QWEN-FASE2-AUTH-RODADA4.md` e `TRIAGEM-REVISOES-RODADA4.md` para
o relato completo. Todos corrigidos e reverificados nesta rodada:

- **Bypass de autenticação com segredo placeholder** — `src/config/env.validation.ts` agora recusa o boot se `JWT_SECRET`/`API_KEY` forem os valores do `.env.example`.
- **Ordem dos guards quebrada** (`PermissionsGuard` rodava antes do `JwtAuthGuard`) — `JwtAuthGuard` virou global, com `@Public()` nas rotas de auth.
- **Suíte e2e vermelha, README mentindo** — corrigida, `.env.test` versionado, 12 testes verdes.
- **Rotação de refresh token não atômica** — `updateMany` condicional, provado com 10 requisições concorrentes.
- **`deactivate()` sem chamador** — `UsersController` criado.

Isso muda o status de dois itens abaixo (marcados com "🔄 rodada 4").

## Passo 1 — antes do primeiro Guard/seed

- [x] **CE-1 decidido**: consumidor sempre confiável, API key global sem
      rotas isentas (ver seção "Decisão CE-1" abaixo). **Implementado** —
      `src/common/guards/api-key.guard.ts`, registrado como `APP_GUARD` em
      `src/app.module.ts`, testado (sem key → 401, key errada → 401, key
      certa → passa).
- [x] **CE-2**: catálogo de permissões como módulo de código compartilhado.
      **Feito** — `src/common/constants/permissions.constants.ts` (fonte
      única usada por `prisma/seed.ts` e por `@Permissions()`/
      `PermissionsGuard`). Correção em relação ao parecer do DeepSeek: ADMIN
      recebe 24 keys, não 28 (28 menos as 4 exclusivas de candidato) — a
      soma "todas as 28" do parecer original era inconsistente com a
      própria lista de exceções que ele deu. Confirmado no banco:
      ADMIN=24, RECRUITER=13, CANDIDATE=8 (total 45 `RolePermission`).
- [x] `package.json`, `tsconfig.json`, `prisma.config.ts`, `.env.example`
      versionados. **Feito** — scaffolding Nest 12 (ESM, Vitest) +
      `prisma.config.ts` + migration inicial aplicada em Postgres 18 local
      (`recrutamento_dev`/`recrutamento_test`, usuário dedicado
      `recrutamento_app`, não o superusuário).
- [x] `generator client` no `schema.prisma` com `moduleFormat` e
      `importFileExtension` explícitos (evita `ERR_UNKNOWN_FILE_EXTENSION`
      dependendo do `tsconfig` do ambiente — achado real da rodada 3).
      **Feito** — `moduleFormat = "esm"`, `importFileExtension = "js"`.
- [x] `omit` global no `PrismaService`/`PrismaClient` cobrindo `password`,
      `tokenHash`, `path` (mitigação de C3). **Feito** —
      `src/prisma/prisma.service.ts`.
- [x] Regra de negócio escrita e implementada: **nenhum endpoint de delete
      físico de `User`** — só `isActive = false`. **Feito** —
      `UsersService.deactivate()` (`src/users/users.service.ts`); nenhum
      controller expõe delete físico de usuário (o módulo de gestão de
      usuários com o endpoint ainda não existe, mas o método de serviço já
      segue a regra desde já).
- [x] Desativação de usuário (`isActive = false`) **revoga todos os
      `RefreshToken` ativos**; fluxo de refresh revalida `isActive`. 🔄
      **rodada 4 — corrigido de verdade**: a auditoria Qwen (C5) provou que
      `deactivate()` não tinha nenhum chamador (não existia controller de
      usuários), então a alegação de "testado" na versão anterior deste
      item não se sustentava. Criado `UsersController` (`PATCH
      /users/:id/deactivate`, protegido por `user:manage`). Agora
      **testado de ponta a ponta de verdade**: admin desativa → `204` →
      `isActive=false` e refresh tokens revogados no banco → login do
      usuário desativado → `401`.
- [ ] `resumeDocument.ownerId === candidateId` validado no Service antes de
      aceitar uma candidatura (não é enforçável só por FK).
- [ ] Regra de negócio escrita: `RESCHEDULED` sempre tem `rescheduledTo`
      preenchido; `CANCELED` nunca tem.
- [ ] Checagem no Service: não é possível criar `Interview` para
      `Application` com `status = WITHDRAWN`.
- [x] DTOs com `@MaxLength` em campos de texto, especialmente `password`
      (bcrypt trunca em 72 bytes silenciosamente) e `name`. **Feito, com
      correção**: a primeira versão usava `@MaxLength(72)` na senha —
      contando *caracteres*, não *bytes*, o que não resolvia o problema
      para senhas com acentuação (comum em português: cada caractere
      acentuado usa 2 bytes em UTF-8, então 72 caracteres acentuados podem
      passar de 72 bytes). Corrigido eliminando o limite pela raiz:
      `src/common/utils/password.util.ts` pré-hasheia a senha com SHA-256
      antes do bcrypt, removendo o truncamento por completo — o `@MaxLength`
      no DTO virou só um teto de sanidade (256), sem relação com o bcrypt.
      Provado com senha de 80+ caracteres acentuados: login com a senha
      completa → `200`; login só com o prefixo (~72 bytes) → `401`.
- [x] Email normalizado (lowercase + trim) antes de checar unicidade/login.
      **Feito** — `normalizeEmail()` em `src/users/users.service.ts`,
      usado tanto no cadastro quanto no login.
- [x] Tabela de casos de teste para a política de precedência
      401→401→403→404→409 (API key, JWT, permissão, dono do recurso, regra
      de negócio). 🔄 **rodada 4**: formalizado como suíte automatizada
      (`test/auth.e2e-spec.ts`) — 401 sem API key, 401 sem JWT, 403 sem
      permission key, 404 de recurso inexistente, 409 de email duplicado
      (inclusive sob concorrência real). `WWW-Authenticate` no `401` ainda
      **não** adicionado — fica como pendência menor (R do Qwen rodada 4,
      "custo de uma linha").
- [x] Guard de autorização funciona de ponta a ponta. 🔄 **rodada 4** (item
      novo, não existia nesta lista): a auditoria provou que
      `PermissionsGuard` rodava antes do `JwtAuthGuard` (guards globais
      sempre rodam antes de guards de controller/rota), então toda rota
      com `@Permissions()` retornaria `403` mesmo para quem tinha a
      permissão — nunca detectado porque nenhuma rota usava isso ainda.
      Corrigido: `JwtAuthGuard` também é global agora, na ordem
      `[ApiKeyGuard, JwtAuthGuard, PermissionsGuard]`, com `@Public()`
      isentando as rotas de auth. Provado com `PATCH /users/:id/deactivate`.
- [x] Validação de ambiente no boot. 🔄 **rodada 4** (item novo): a
      auditoria forjou um JWT válido usando o `JWT_SECRET` literal do
      `.env.example` e autenticou como qualquer usuário — bypass total de
      autenticação em qualquer deploy que esquecesse de trocar os
      segredos. Corrigido: `src/config/env.validation.ts` (Joi) recusa o
      boot se `JWT_SECRET`/`API_KEY` forem os placeholders do `.env.example`
      ou iguais entre si. Provado: boot com o placeholder → crash
      controlado, antes de qualquer rota existir.

## Gate Fase 3 (concorrência)

- [ ] `CHECK (filledCount <= vacancies)` e `CHECK (filledCount >= 0)`
      adicionados via SQL na migration, **com verificação de que sobrevivem**
      a um `migrate dev` posterior (não é modelado pelo Prisma, pode ser
      derrubado em silêncio por uma migration futura que recrie a tabela).
- [ ] Dentro do lock, a transação valida **as duas** invariantes:
      `filledCount <= vacancies` **e** `count(Application WHERE status =
      HIRED) <= vacancies` (o contador armazenado sozinho pega o sintoma,
      não a causa).
- [ ] `updatedAt DEFAULT now()` explícito via SQL na migration bruta (fecha
      a lacuna que só importa porque a Fase 3 escreve SQL à mão).
- [ ] Teste `Promise.all` com N requisições simultâneas, **contra PostgreSQL
      real** (banco embutido derruba conexão sob carga — já provado nas
      rodadas anteriores), assertando as duas invariantes acima.
- [ ] Qualquer `$queryRaw` usado no lock seleciona só as colunas
      estritamente necessárias — `omit` global não se aplica a SQL cru.
- [ ] Índice de expressão (ou `citext`) para `User.email` case-insensitive
      no banco — hoje a normalização (`lowercase`+`trim`) só existe na
      aplicação; um `INSERT` via SQL bruto (que esta fase já prevê) pode
      criar `A@x.com` ao lado de `a@x.com` (achado Qwen rodada 4, R13).
- [x] Erros do Prisma (`P2002`, `P2003`, `P2034`, `P2028`) mapeados
      explicitamente para `409`/`400`/`404` no filtro global — nunca `500`.
      **Adiantado da rodada 4** (achado R1, "corrigir antes da Fase 5" virou
      "corrigido agora" porque já era alcançável em `POST /auth/register`
      sem nenhuma concorrência real de vaga): `src/common/filters/
      prisma-exception.filter.ts`. Provado com 5 registros simultâneos com
      o mesmo email: 1×`201`, 4×`409`, zero `500`.

## Gate Nível B (só se/quando o endpoint de ADMIN editar permissões existir)

- [ ] Trava de "último administrador" (Service, mínimo viável).
- [ ] Revogação não-destrutiva de `RolePermission` (soft-delete com autor),
      resolvendo também a "aposentadoria" de uma `Permission` concedida por
      engano (hoje impossível de remover por causa do `Restrict`).
- [ ] Proibição de `DELETE` de `Role` via endpoint (hoje `Role →
      RolePermission` continua `Cascade` — aceitável só enquanto papéis só
      vêm do seed).
- [ ] `isSystem` efetivamente impede rename/exclusão dos 3 papéis do
      enunciado no Service (hoje o campo existe mas não protege nada
      sozinho).

## Decisão CE-1 — resolvida

**O consumidor da API é sempre um cliente confiável** (Postman, Swagger UI,
curl, Thunder Client, ou o avaliador testando diretamente) — não existe
frontend/SPA no escopo desta avaliação. Consequência: a API key é exigida
**globalmente**, via `APP_GUARD` único, **sem lista de rotas isentas**,
inclusive em `/auth/login` e na listagem pública de vagas. O guard fica
simples, como já estava desenhado em `FASE-1-MODELAGEM.md` §5.1.

**Nota para o futuro (registrada, não decidida agora):** existe a
possibilidade de, como melhoria pós-obrigatório, adicionar um frontend para
apresentação do projeto. Se isso acontecer, a arquitetura de API key
**precisa ser revisitada** — um frontend rodando no navegador do usuário
(fetch direto, ou um app Angular) exporia a chave no bundle JS, quebrando a
premissa desta decisão. Duas saídas nesse cenário futuro: (a) o frontend
não chama a API de recrutamento diretamente, um backend-for-frontend (BFF)
guarda a API key no servidor e repassa as chamadas, ou (b) a API key deixa
de ser global e vira isenta nas rotas que esse frontend chamaria. Ver
`FEEDBACKS-MELHORIA.md` #10.
