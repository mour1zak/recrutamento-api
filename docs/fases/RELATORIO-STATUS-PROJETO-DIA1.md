# Relatório Completo do Projeto — Plataforma de Recrutamento (AV-04)

> Documento-fonte para gerar um artefato de apresentação (ex.: no
> Claude.ai). Cobre tudo desde o pedido original até o estado atual,
> quem fez o quê, e o que falta, com um cronograma de 4 dias × 8h.
> Gerado no Dia 1, ~6-7h de trabalho já consumidas.

---

## Página 1 — Visão Geral e Objetivo

**O que é:** a AV-04-RECRUTAMENTO é uma avaliação técnica que pede uma
API backend completa para uma **Plataforma de Recrutamento**, avaliada
pela modelagem, arquitetura, integração entre componentes, regras de
negócio, segurança, tratamento de erros, testes e qualidade da entrega.

**Nota sobre o prazo:** o enunciado original diz "5 dias". O cronograma
real acordado para este projeto é **4 dias × 8h = 32 horas totais**. Este
relatório usa sempre o segundo número.

**Stack obrigatória:** NestJS + TypeScript; PostgreSQL; Prisma **7.10.0**
com `prisma.config.ts`, driver adapter e migrations; DTOs com
`class-validator` + `ValidationPipe`; JWT com `@CurrentUser()`;
autorização por papel/permissão; relacionamentos Prisma; upload de
arquivo; `HttpService`; ao menos um Interceptor útil; `.env`/
`ConfigService`; Helmet; Compression; tratamento coerente de `400`,
`401`, `403`, `404`, `409`; build de produção limpo; README completo.

**Perfis:** CANDIDATE, RECRUITER, ADMIN, com matriz de permissões
coerente — usuários não podem manipular recursos de terceiros só
trocando IDs na requisição.

**Entidades mínimas exigidas:** User, Company, Job, CandidateProfile,
Application, Interview, Document (entidades associativas/auxiliares são
permitidas).

**Regras de negócio obrigatórias:** candidatura duplicada proibida; vaga
inativa não aceita candidatura; recruiter só opera vagas da própria
empresa; referências a recursos inexistentes tratadas; operações
incompatíveis com o estado atual rejeitadas; transições de status
coerentes; dados sensíveis nunca aparecem nas respostas; operações
pessoais sempre usam a identidade autenticada (nunca um ID vindo do
body).

**Upload obrigatório:** currículo/documento, com validação de presença,
tamanho e tipo, conectado a uma funcionalidade real do domínio.

**Integração externa obrigatória:** `HttpService` consumindo CEP/
localização da empresa, config via ambiente, erros/timeout tratados.

**Os 10 cenários de teste obrigatórios:**
1. Fluxo principal com sucesso
2. Body inválido → `400`
3. Ausência/token inválido → `401`
4. Usuário autenticado sem permissão → `403`
5. Recurso inexistente → `404`
6. Conflito de regra de negócio → `409`
7. Tentativa de acesso a recurso de terceiro
8. Upload válido e inválido
9. Integração externa funcionando e falhando de forma controlada
10. Fluxo completo de mudança de estado

**Entregáveis:** código-fonte; schema Prisma + migrations; `.env.example`;
README completo; documentação/lista de endpoints; exemplos de requisição;
instruções de instalação/migration/execução/build; `npm run build` sem
erros.

**Bônus (lista fechada, só depois do obrigatório):** paginação, filtros,
ordenação, Swagger, seed, testes automatizados, Docker, indicadores do
domínio.

---

## Página 2 — Arquitetura da Solução

**Stack real implementada:** NestJS 12 (ESM, `"type": "module"`) +
Vitest como test runner; Prisma 7.10.0 com `@prisma/adapter-pg` (driver
adapter, obrigatório no Prisma 7) e `prisma.config.ts` substituindo o
`.env`-based CLI config legado; PostgreSQL 18 local, usuário dedicado
não-superusuário `recrutamento_app`, bancos separados
`recrutamento_dev`/`recrutamento_test`.

**Modelo de dados — 12 entidades:**

| Entidade | Propósito |
|---|---|
| `User` | Conta autenticável; `roleId` aponta pro RBAC dinâmico |
| `Role` | Papel do RBAC dinâmico (`app_roles`) |
| `Permission` | Chave de permissão única (`app_permissions`) |
| `RolePermission` | Junção Role↔Permission (`app_role_permissions`) |
| `RefreshToken` | Token de sessão (hash), rotação/revogação |
| `CandidateProfile` | Perfil 1:1 do candidato |
| `Company` | Empresa; `isActive` em vez de delete físico |
| `Job` | Vaga; controla `vacancies`/`filledCount` |
| `Application` | Candidatura a uma vaga; `@@unique([candidateId, jobId])` |
| `ApplicationStatusHistory` | Auditoria de transições de status |
| `Interview` | Entrevista; reagendamento cria nova linha |
| `Document` | Arquivo enviado; `path` único |

Mais 4 enums (`JobStatus`, `ApplicationStatus`, `InterviewStatus`,
`DocumentType`).

**RBAC dinâmico via banco** (não enum fixo em TypeScript) — **28
permission keys** no catálogo, distribuídas: **CANDIDATE=8**,
**RECRUITER=13**, **ADMIN=24** (45 `RolePermission` no total). `Object.
values(PERMISSIONS)` é a fonte única de verdade, usada tanto pelo seed
quanto pelos Guards.

**Camadas de defesa (defense in depth):**
1. `ApiKeyGuard` (global) — toda rota exige `x-api-key`, sem exceção,
   inclusive `/auth/login` e `/health` (decisão CE-1: o consumidor da
   API é sempre um cliente confiável — Postman/Swagger/curl, sem
   frontend no escopo).
2. `JwtAuthGuard` (global, com `@Public()` isentando rotas de auth) —
   valida o JWT e **revalida o usuário no banco a cada request**
   (`findAuthenticatedById`), então uma desativação/mudança de permissão
   já vale na próxima requisição, sem esperar o token expirar.
3. `PermissionsGuard` (global) — checa `@Permissions(...)` contra as
   permissions do usuário autenticado, `403` se faltar.
4. `GlobalExceptionFilter` (global, único) — nunca deixa erro de Prisma
   ou exceção genérica virar `500` cru; mapeia `P2002`→`409` (com nome
   do campo), `P2025`→`404` (com nome do modelo), `P2003`→`400`,
   `P1xxx`→`503`, conflito de transação `Serializable`→`409`, `401`
   sempre com header `WWW-Authenticate: Bearer`.

**Decisões de arquitetura e o porquê:**
- **API key global sem rotas isentas (CE-1):** o consumidor é sempre
  confiável — não existe SPA/frontend no escopo desta avaliação, então
  não há risco de expor a key num bundle JS público.
- **RBAC dinâmico (banco) em vez de enum:** permite editar permissões em
  runtime (Nível B, ainda não implementado) sem deploy novo — custo
  aceito: uma query a mais por request autenticado, sem cache (decisão
  registrada, não implementada, ver `FEEDBACKS-MELHORIA.md`).
- **`Serializable` na trava de último administrador:** a invariante
  ("sempre existe ≥1 ADMIN ativo") depende de um `count()` agregado
  sobre múltiplas linhas, não de uma linha só — por isso não usa o
  padrão de `UPDATE` condicional (`updateMany`+`count===1`) usado na
  rotação de refresh token.
- **SHA-256 pré-hash antes do bcrypt:** bcrypt trunca em 72 **bytes**
  (não caracteres) — sem o pré-hash, senhas longas com acentuação
  perdiam caracteres silenciosamente. Achado pelo próprio usuário, não
  pelo Qwen.
- **`omit` global no `PrismaService`:** `password`/`tokenHash`/`path`
  nunca saem em nenhuma query por padrão — elimina a classe de bug "só
  esqueci de tirar o campo desta query específica".

---

## Página 3 — Os Três Agentes de IA e Seus Papéis

| Agente | Papel | Faz | Não faz |
|---|---|---|---|
| **Claude Code** (eu) | Implementador | Escreve todo o código, testes, documentação de processo; roda builds/testes reais; corrige achados dos outros dois agentes | Não audita o próprio trabalho de forma independente — depende do Qwen para isso |
| **Qwen** | QA Lead / DevSecOps, com poder de veto | Audita código **por execução real** (não só leitura) — builds, testes de carga/concorrência, curl manual; aponta críticos e ressalvas; emite veredito REPROVADO / APROVADO COM RESSALVAS | Não escreve código nem propõe implementação — só diz o que está errado e por quê |
| **DeepSeek** | Estrategista de negócio/infraestrutura | Valida/refina matriz de permissões, fluxos de estado, planeja seed, define o mapa de endpoints REST (rotas, permission keys, regras) | Não escreve código nem audita segurança |
| **Usuário** | Engenheiro responsável pela entrega | Orquestra os três agentes, decide produto/negócio, valida rotas manualmente (Postman/Thunder Client/curl), aprova mudanças destrutivas | — |

**Modelo de colaboração combinado nesta sessão:** Claude Code continua
escrevendo os testes e2e automatizados (para não travar o ritmo), mas
sempre explicando o contexto do que testa; antes de cada módulo novo,
explica em passos o que vai ser feito (rotas, DTOs, regras) para o
usuário acompanhar o raciocínio; a validação manual das rotas (Postman/
Thunder Client/curl) fica com o usuário, que depois traz o resultado
para revisão.

---

## Página 4 — Linha do Tempo Cronológica

### Fase 1 — Modelagem (schema + decisões de arquitetura, sem código de aplicação)

- **Rodada 2 (Qwen): REPROVADO.** 6 críticos + 3 novos (RBAC/API key) + 5
  regressões: `CHECK` de `filledCount` ausente; `include` vazando
  `password`/`tokenHash`/`path`; política de deleção "contraditória";
  `Cascade` destrutivo em `RolePermission` sem trava de último admin;
  API key sem modelo de dados; nomes de tabela colidindo com palavras
  reservadas do Postgres (`Role`, `Permission`).
- **Rodada 3 (Qwen): APROVADO COM RESSALVAS.** Libera a Fase 2 com 2
  condições de entrada: **CE-1** (decidir o tipo de consumidor da API
  antes do primeiro Guard) e **CE-2** (versionar o catálogo de 28
  permissions como código, não como prosa).
- **Parecer do DeepSeek (Fase 1):** validou a matriz de permissões (28
  keys), expandiu os fluxos de estado de Job/Application/Interview,
  planejou o seed (12 usuários, 2 empresas, 7 vagas, 9 candidaturas, 5
  entrevistas, 8 documentos) e 8 cenários de teste de integração CEP.
  Corrigiu depois um erro de soma: ADMIN tem 24 keys, não 28.

### Fase 2 — Auth/RBAC (primeira auditoria de código de aplicação real)

- **Rodada 4 (Qwen): REPROVADO.** 5 críticos achados por execução real:
  JWT forjado com o secret literal do `.env.example` era aceito (bypass
  total); `PermissionsGuard` rodava antes do `JwtAuthGuard` (guards
  globais sempre rodam antes de guards de controller); suíte e2e
  vermelha com o README afirmando o contrário; rotação de refresh token
  com janela de corrida (check-then-write); `deactivate()` sem nenhum
  controller expondo a rota.
- **Rodada 5 (Qwen): APROVADO COM RESSALVAS.** Os 5 críticos seguraram
  sob carga **maior** que a testada antes (20 refreshes concorrentes vs.
  10). 1 crítico novo, criado indiretamente pela própria correção da
  rodada 4: **o último ADMIN conseguia se autodesativar**, sem rota de
  reversão.
- **Rodada 6 (Qwen): APROVADO COM RESSALVAS.** A trava do último admin
  segurou sob carga adversarial pesada (8 admins, desativações mútuas
  simultâneas) — mas expôs um defeito de contrato: o conflito de
  transação `Serializable`, quando ocorre de verdade, chega como um
  `DriverAdapterError` não documentado do driver adapter do Prisma 7
  (`TransactionWriteConflict`), não como `PrismaClientKnownRequestError`
  com `code: P2034` — o filtro antigo nunca reconhecia isso, e o
  conflito virava `500` cru em **67% das corridas medidas**. Também achou
  um bloqueante de infra: `prisma generate` falhava sem `DATABASE_URL`
  em clone novo/CI.
- **Correções da rodada 6 (fecham a Fase 2):** filtro de exceções
  unificado reconhecendo o `TransactionWriteConflict` por duck-typing;
  `prisma.config.ts` tolerante à ausência de `DATABASE_URL`; nova rota
  `PATCH /users/:id/reactivate`; `npm run db:reset:test` para
  reentrância da suíte; mais 4 ressalvas de custo baixo fechadas.
- **Rodada 7:** pacote reenviado ao Qwen, **aguardando resposta agora.**

**Em paralelo:** o DeepSeek recebeu o pedido do mapa de endpoints do
restante do domínio e devolveu **41 rotas** (Company, Job, Application,
CandidateProfile, Interview, Document, Users, RBAC Nível B) — nenhuma
implementada ainda.

---

## Página 5 — Cadeia de Custódia

| Serviço/Arquivo | Ação | Responsável | Quando | Resultado |
|---|---|---|---|---|
| `prisma/schema.prisma` | Autoria + 9+ correções | Claude Code (autor) / Qwen (auditor, rodadas 2-3) | Fase 1 | 12 entidades, constraints/índices corrigidos |
| `src/common/guards/api-key.guard.ts`, `jwt-auth.guard.ts`, `permissions.guard.ts` | Implementação + correção de ordem | Claude Code / Qwen (achou a ordem quebrada, C2 rodada 4) | Fase 2, rodada 4 | Ordem `[ApiKey, Jwt, Permissions]`, todos globais |
| `src/common/filters/global-exception.filter.ts` | Implementação + consolidação | Claude Code / Qwen (R1 rodada 4, N2/N3 rodada 5, N1-a rodada 6) | Fase 2, rodadas 4-6 | Filtro único, nunca `500` para erro conhecido |
| `src/users/users.service.ts` (`deactivate`/`reactivate`) | Implementação | Claude Code / Qwen (C5 rodada 4, N1 rodada 5, N1-a/N1-c rodada 6) | Fase 2, rodadas 4-6 | Trava de último admin + reversão, testado sob concorrência |
| `src/config/env.validation.ts` | Implementação | Claude Code / Qwen (C1 rodada 4) | Fase 2, rodada 4 | Boot recusa secrets placeholder |
| `src/common/constants/permissions.constants.ts` | Planejamento + implementação | DeepSeek (matriz original, Fase 1) / Claude Code (código, CE-2) / Qwen (correção ADMIN=24, R14 rodada 4) | Fase 1-2 | 28 keys, fonte única pro seed e guards |
| `docs/fases/PARECER-DEEPSEEK-FASE2-ENDPOINTS.md` | Planejamento | DeepSeek (autoria do mapa de 41 rotas) | Fase 2, recebido e salvo nesta sessão | 8 grupos de rotas, 6 decisões em aberto — ainda não implementado |
| `README.md`, `docs/fases/*` | Autoria de todo processo | Claude Code | Contínuo | Documento histórico completo da avaliação |

---

## Página 6 — Status Atual

### Obrigatório (README §2.1)

| Item | Status |
|---|---|
| Modelagem Prisma (relacionamentos/constraints/enums) | 🟢 Aprovada com ressalvas, migration aplicada |
| JWT + `@CurrentUser()` | 🟢 Registro, login, refresh (com rotação), logout |
| Autorização por papel (CANDIDATE/RECRUITER/ADMIN) | 🟢 RBAC dinâmico ponta a ponta |
| CRUDs/gestão de entidades | 🟡 Só `deactivate`/`reactivate` de usuário |
| Consultas por relacionamento | ⬜ Não iniciado |
| Fluxos de estado do domínio (Job/Application/Interview) | 🟡 Desenhado, não implementado |
| Upload de currículo/documento | ⬜ Não iniciado |
| Integração externa (`HttpService`, CEP) | ⬜ Não iniciado |
| Interceptor coerente | ⬜ Não iniciado |
| Helmet + Compression | 🟢 Feito |
| Tratamento 400/401/403/404/409 | 🟢 Os 5 demonstrados automaticamente |
| Build de produção limpo | 🟢 Feito |
| 10 cenários de teste obrigatórios | 🟡 4 de 10 cobertos (sucesso, `400`, `401`, `409` — inclui concorrência) |

### Bônus (README §2.2) — todos ⬜ não iniciados
Paginação, filtros, ordenação, Swagger, seed completo de domínio, testes
automatizados adicionais, Docker, indicadores.

### Além do pedido (README §2.3)
`ApplicationStatusHistory` como entidade auditável; docs por fase
revisados por duas lentes externas; API key como camada adicional
(recomendação verbal do avaliador); RBAC dinâmico via banco (incluindo
Nível B, ainda não implementado); validação de ambiente no boot; filtro
global de exceções.

### Conscientemente fora do escopo (README §2.4)
4 vulnerabilidades "high" do `npm audit` são transitivas do driver MySQL
embutido no CLI do Prisma (não usado, dev-only) — corrigir quebraria a
exigência de Prisma 7.10.0. Rate limiting em `/auth/login` ainda pendente
de decisão.

---

## Página 7 — O Que Falta

**Mapa de 41 rotas do DeepSeek, nenhuma implementada ainda:**

| Grupo | Rotas | Observação |
|---|---|---|
| Companies | 5 | Sem `DELETE` físico |
| Jobs | 6 | `DELETE` deliberadamente não exposto — soft-delete via `PATCH /jobs/:id/status {CANCELED}` |
| Applications | 6 | Payload condicional por papel/status do candidato |
| Candidate Profile | 3 | Idem |
| Interviews | 4 | `RESCHEDULED` sempre cria novo registro |
| Documents | 3 | Escopo de leitura por dono ou recrutador da vaga |
| Users | 6 | 2 novas além das existentes: `PATCH /:id/company`, `PATCH /:id/role` |
| RBAC Nível B | 3 | Só desenho, sem código |
| Auth + Health | 5 | Já existem |

**Itens obrigatórios não iniciados:** upload de documento (`POST
/documents`, multipart, validação de MIME/tamanho); integração CEP via
`HttpService`; interceptor; 6 dos 10 cenários de teste obrigatórios
(terceiro/acesso indevido, upload, integração externa, mudança de
estado completa, mais os que dependem de módulos ainda não escritos);
regras de negócio pendentes (ownership de documento, `RESCHEDULED`/
`CANCELED` mutuamente exclusivos, bloqueio de `Interview` para
`Application WITHDRAWN`).

**Gate Fase 3 (concorrência):** `CHECK` constraints com verificação de
sobrevivência a migration futura; dupla invariante na transação
(`filledCount<=vacancies` **e** `count(HIRED)<=vacancies`); pool do `pg`
configurado com timeout; índice case-insensitive de email; teste
`Promise.all` contra Postgres real.

**Gate Nível B:** trava de último admin em nível de DB (hoje só em
Service); revogação não destrutiva de `RolePermission`; `DELETE Role`
proibido; `isSystem` efetivamente protegendo os 3 papéis do seed.

**6 decisões em aberto levantadas pelo próprio DeepSeek** (com a
recomendação dele):
1. `job:delete` reservada no catálogo sem rota exposta — **recomendado: sim**.
2. Contrato de `RESCHEDULED` — `201` com a nova entrevista (**recomendado**) vs. `200` com `{old, new}`.
3. Padronizar `?page&limit` em toda listagem desde já.
4. `PATCH /interviews/:id` em entrevista terminal — `409` (**recomendado**) ou permitir corrigir feedback.
5. Formato do `409` de `deactivate` — estruturado com `reason` (**recomendado: sim**, `cannot_deactivate_self`/`last_active_admin`/`already_inactive`).
6. `document:read:any` para ADMIN — adicionar ao catálogo (ADMIN iria a 25 keys) se auditoria documental completa for requisito.

**Outras decisões em aberto:** timing do Swagger (decidido nesta sessão:
só quando os controllers de domínio começarem a ser escritos); rate
limiting em `/auth/login` (`@nestjs/throttler` já instalado, não usado);
pool de conexão do `pg`.

---

## Página 8 — Checklist Cronológico de 4 Dias × 8h (32h)

*Estimativa inicial para calibrar no Claude.ai — não é compromisso
rígido.*

**Dia 1 (8h) — usadas ~6-7h, resta ~1-2h**
- [x] Fase 1 completa (modelagem + RBAC dinâmico + decisões CE-1/CE-2)
- [x] Fase 2 Auth/RBAC — rodadas 4, 5 e 6 do Qwen, todas fechadas
- [x] Mapa de 41 endpoints do DeepSeek recebido
- [ ] Resposta do Qwen à Rodada 7 (em andamento)
- [ ] Decidir as 6 pendências do DeepSeek antes de abrir os Controllers

**Dia 2 (8h)**
- [ ] Resolver as 6 decisões em aberto (formato de erro estruturado, `RESCHEDULED`, paginação, etc.)
- [ ] Módulo Companies (5 rotas) — CRUD + regras + testes e2e
- [ ] Módulo Jobs (6 rotas) — CRUD + transições de status + testes e2e
- [ ] Validação manual do usuário (Postman/curl) dos dois módulos

**Dia 3 (8h)**
- [ ] Módulo CandidateProfile (3 rotas)
- [ ] Módulo Applications (6 rotas) — duplicidade, payload condicional, transições
- [ ] Módulo Interviews (4 rotas) — fluxo de reagendamento
- [ ] Módulo Documents (3 rotas) — upload obrigatório, validação de MIME/tamanho
- [ ] Integração externa CEP via `HttpService`
- [ ] Interceptor obrigatório

**Dia 4 (8h)**
- [ ] Gate Fase 3: `CHECK` constraints, dupla invariante, teste `Promise.all` real
- [ ] Cobertura dos 10 cenários de teste obrigatórios (completar os 6 restantes)
- [ ] Bônus priorizados: Swagger (mais barato agora, controllers já existem), seed completo de domínio, paginação/filtros/ordenação
- [ ] README final completo (endpoints, instalação, execução)
- [ ] Build de produção final + revisão geral

---

## Página 9 — Riscos e Recomendações

- **Volume alto para o tempo restante:** 41 rotas + upload + integração
  externa + concorrência real em ~25h restantes é ambicioso.
  Recomendação: priorizar rigidamente o obrigatório antes de qualquer
  bônus, e limitar o tempo por módulo (time-boxing).
- **Rate limiting e pool do `pg`** devem entrar antes do Gate Fase 3
  (achados já registrados como pré-requisitos, N9/N15).
- **Decisão do formato de erro estruturado** deve ser tomada logo no
  início do Dia 2 — decidir depois de já ter escrito vários controllers
  significa reescrever todos eles.
- **Modelo de colaboração vigente:** Claude Code escreve os testes e2e e
  explica em passos antes de cada módulo novo; usuário valida rotas
  manualmente (Postman/Thunder Client/curl) e revisa os resultados;
  nenhuma mudança destrutiva (ex.: `prisma migrate reset`) roda sem
  confirmação explícita em chat, mesmo em banco de teste.

---

## Anexo — Notas desta sessão

- Corrigidas duas inconsistências de documentação antes deste relatório:
  cabeçalho de status do `README.md` (estava desatualizado, dizia "Fase
  2, Passo 1 concluído" e "12 testes") e a ausência do
  `docs/fases/PARECER-DEEPSEEK-FASE2-ENDPOINTS.md` (a resposta do
  DeepSeek com o mapa de 41 rotas nunca tinha sido salva como arquivo).
- O enunciado original (`AV-04-RECRUTAMENTO.md`) fala em "5 dias"; o
  cronograma real acordado com o usuário é **4 dias × 8h** — este
  relatório usa sempre o segundo número.
- Números confirmados por execução real nesta sessão antes de entrar no
  relatório: `npm run build` limpo, `npm run lint` zero avisos, `npm
  test` 1/1, `npm run test:e2e` 14/14 (total 15 testes automatizados).
