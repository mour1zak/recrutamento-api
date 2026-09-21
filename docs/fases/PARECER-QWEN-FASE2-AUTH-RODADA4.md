# Parecer — Qwen (QA Lead & DevSecOps) — Fase 2: Auth, Rodada 4

> Registro do retorno recebido em resposta a `PACOTE-QWEN-FASE2-AUTH.md`.
> Condensado mas fiel ao original (relatório completo anexado pelo
> usuário, `RELATORIO-QWEN-FASE2-AUTH-RODADA4.md`). Triagem em
> `TRIAGEM-REVISOES-RODADA4.md`.

**Veredito: REPROVADO.** Não pelo schema (aprovado desde a rodada 3) nem
pela qualidade geral do código — pelo primeiro código de aplicação
auditado, com **5 achados críticos reproduzidos executando o projeto**
(não especulação): build em clone fresco, testes unitário/e2e, um app Nest
mínimo reproduzindo a topologia real dos guards, e um app Nest forjando um
JWT com o segredo público do `.env.example`.

## Checklist "Gate Fase 2, Passo 1" — 5 de 6 confirmados

Toolchain, `generator` explícito, `omit` global, catálogo de permissões em
fonte única (CE-2, incluindo a correção do número do ADMIN: 24, não 28) e
CE-1 — todos confirmados por execução. R-C4.1 (desativação revoga refresh
tokens) só parcialmente: o código está correto, mas o método não tinha
nenhum chamador (ver C5).

## Falhas críticas

- **C1 — Bypass total de autenticação com segredo público versionado.**
  JWT forjado com o `JWT_SECRET` literal do `.env.example` foi aceito por
  um app configurado como o do projeto. Qualquer deploy que siga o README
  e esqueça de trocar os segredos autentica como qualquer usuário,
  inclusive ADMIN.
- **C2 — `PermissionsGuard` global rodava antes do `JwtAuthGuard` de
  controller.** Guards globais (`APP_GUARD`) sempre rodam antes de guards
  de controller/rota — `request.user` chegava `undefined` no
  `PermissionsGuard`, e toda rota com `@Permissions()` retornaria `403`
  mesmo para quem tem a permissão. Não detectado ainda porque nenhuma rota
  usava `@Permissions()`. O comentário do guard afirmava o oposto do
  comportamento real.
- **C3 — Suíte e2e vermelha; README afirmava o contrário.** Falhava em
  dois modos (sem `.env.test`: crash no boot; com envs: `401` porque o
  teste não enviava `x-api-key`). Sem suíte verde, os 10 cenários
  obrigatórios não têm onde morar.
- **C4 — Rotação de refresh token não atômica** (check-then-write): duas
  requisições concorrentes com o mesmo token liam ambas `revokedAt = null`
  antes de qualquer uma escrever, e as duas emitiam par novo — mesma classe
  de bug do `filledCount` (lição nº 2 da avaliação anterior), em outro
  recurso.
- **C5 — `deactivate()` sem nenhum chamador** (nenhum controller de
  usuários existia). O checklist marcava `[x]` "testado" para um caminho
  inalcançável por qualquer requisição.

## Respostas às 5 perguntas (resumo)

1. Refresh token (48 bytes aleatórios + SHA-256 determinístico + rotação):
   **padrão correto**, HMAC não necessário — priorizar a atomicidade (C4).
2. Ordem `[ApiKeyGuard, PermissionsGuard]`: a ordem relativa entre os dois
   globais está certa; o problema é a ausência do `JwtAuthGuard` global
   entre eles (é o C2).
3. Nenhum vazamento de dado sensível nas respostas do `AuthController` —
   bem resolvido. Mas: mensagem de erro do `ApiKeyGuard` quando `API_KEY`
   não está configurada devolve `401` (deveria ser `500`/`503`) e revela
   estado interno de configuração; `console.log` da senha do seed no stdout.
4. `bcryptjs`: medido em 72ms/operação nesta máquina — amplifica DoS sem
   rate limiting, e cria enumeração de conta por tempo de resposta
   (usuário inexistente responde em ~0ms). Sugestão estrutural:
   `crypto.scrypt` da stdlib do Node, resolve build nativo + limite de 72
   bytes + é memory-hard. Pré-hash SHA-256 correto tecnicamente, falta
   normalização Unicode (NFC).
5. Lacunas: concorrência em qualquer escrita (email duplicado vira 500 sem
   filtro global — R1), desativação com sessão ativa não testável (C5),
   reuso de refresh roubado sem revogar família (C4), enumeração por timing
   (P4), nenhuma operação pessoal usando `@CurrentUser()` ainda (esperado
   nesta fase).

## Ressalvas exigidas para reapresentação (além dos 5 críticos)

R1 (filtro global de exceções — `P2002`/`P2003`/`P2034`/`P2028` nunca
`500`) e R4 (seed sem credencial hardcoded/logada, com trava de
`NODE_ENV=production`).

## Ressalvas menores (não bloqueiam)

R2 (check-then-create em `createCandidate`), R3 (rate limiting ausente,
`@nestjs/throttler` instalado e não usado), R5 (`JWT_REFRESH_SECRET` morto
no `.env.example`), R6 (`parseDurationToMs` sem validação — `"1w"` vira
500), R7 (tipagem furada por `as never`), R8 (build em clone fresco falha
sem `prebuild`; falta `engines` no `package.json`), R9 (`logout` não
confere `count` do `updateMany`), R10 (API key sem rotação — aceito como
decisão CE-1), R11 (seed deriva do `ROLE_PERMISSIONS`, não do catálogo
completo `PERMISSIONS`), R12 (`APIKEY_MANAGE` é permissão morta), R13
(normalização de email só na aplicação, não no banco), R14 (parecer do
DeepSeek ainda cita 49 grants), R15 (`GET /` "Hello World" atrás do guard).

## O que está bom e deve ser preservado

Todas as correções de schema da rodada 3 confirmadas no DDL da migration.
`CONDICOES-ENTRADA-FASE2.md` chamado de "melhor artefato de processo do
projeto". `omit` global com override pontual no login — "melhor do que eu
pedi". Catálogo de permissões tipado resolveu o R1 da rodada 2
estruturalmente. Investigação do `@MaxLength(72)` chamada de "achado
interno de qualidade". `JwtStrategy` revalidando no banco — correto.

## Condição para reapresentação

C1–C5 corrigidos com prova (app não sobe com segredo placeholder; teste
e2e de rota com `@Permissions()`; `test:e2e` verde; teste de duas chamadas
concorrentes ao refresh resultando em um par novo; `deactivate()` com
chamador e teste) + R1 e R4 antecipadas.
