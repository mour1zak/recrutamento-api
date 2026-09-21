# Condições de Entrada — Fase 2

Checklist de aceite construído a partir do parecer do Qwen (rodada 3,
`PARECER-QWEN-FASE1-RODADA3.md`) e do DeepSeek. Existe para que nenhuma
exigência vire "promessa esquecida" — o próprio Qwen citou isso como risco.
Marcar conforme for implementado; não avançar para os itens de "Gate Fase 3"
sem os de "Passo 1" resolvidos.

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
      `RefreshToken` ativos**; fluxo de refresh revalida `isActive`. **Feito**
      — `UsersService.deactivate()` roda os dois updates numa
      `$transaction`; `AuthService.refresh()`/`JwtStrategy.validate()`
      sempre passam por `findAuthenticatedById()`, que retorna `null` (→
      `401`) se `isActive = false`. Teste manual completo: login → logout
      revoga o refresh usado → reuso do mesmo token → `401` (confirmado via
      curl). Teste específico de "desativar enquanto sessão está ativa"
      ainda não automatizado — método existe e a leitura de `isActive` já
      é respeitada, mas falta um teste demonstrando o caminho via
      desativação (não só via logout).
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
- [ ] Tabela de casos de teste para a política de precedência
      401→401→403→404→409 (API key, JWT, permissão, dono do recurso, regra
      de negócio) — decidir também se `401` inclui `WWW-Authenticate`.
      **Parcial**: os casos de API key/JWT/400/409 já foram verificados
      manualmente (ver relatório desta etapa); falta formalizar como
      suíte de testes automatizados e decidir o `WWW-Authenticate`
      (ainda não adicionado).

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
- [ ] Erros do Prisma (`P2002`, `P2003`, `P2034`, `P2028`) mapeados
      explicitamente para `409`/`400` no filtro global — nunca `500`.

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
