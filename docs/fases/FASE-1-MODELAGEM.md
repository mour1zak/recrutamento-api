# Fase 1 — Fundamentação e Modelagem

> Status: **proposta aguardando validação**. Nenhum código de serviço foi
> escrito ainda. Este documento existe para ser revisado pelo Qwen (lente
> ORM/DevSecOps) e pelo DeepSeek (lente de negócio/infra) antes de avançarmos
> para a Fase 2.

## 1. Do texto ao modelo (AV-04-RECRUTAMENTO.md)

### 1.1 Substantivos → entidades candidatas

```text
Usuário (Candidate, Recruiter, Admin) → User
Perfil de candidato                   → CandidateProfile
Empresa                               → Company
Vaga                                  → Job
Candidatura                           → Application
Entrevista                            → Interview
Documento/Currículo                   → Document
Histórico de status da candidatura    → ApplicationStatusHistory (entidade
                                         auxiliar, não pedida explicitamente,
                                         mas necessária para "histórico
                                         quando necessário" + auditoria)
Token de renovação de sessão          → RefreshToken (auxiliar, suporte a
                                         logout/revogação)
```

### 1.2 Verbos → ações/endpoints (mapa preliminar, será detalhado na Fase 2)

```text
autenticar, registrar, renovar sessão
criar/editar/consultar empresa
criar/editar/consultar/fechar vaga
candidatar-se, retirar candidatura, avaliar candidatura (mudar status)
agendar/atualizar/cancelar entrevista
enviar/consultar documento (upload de currículo)
consultar candidaturas de uma vaga (recruiter, só da própria empresa)
consultar candidaturas do usuário autenticado
```

### 1.3 Relacionamentos e cardinalidade

```text
Company  1 ───── N User        (recrutadores de uma empresa)
Company  1 ───── N Job
User     1 ───── 1 CandidateProfile        (apenas quando role = CANDIDATE)
User     1 ───── N Application  (candidato)
User     1 ───── N Job          (recruiter que criou a vaga)
Job      1 ───── N Application
Application 1 ── N ApplicationStatusHistory
Application 1 ── N Interview
Document 1 ────── N Application (um documento pode ser reaproveitado em
                                  várias candidaturas do mesmo candidato —
                                  a FK fica em Application.resumeDocumentId,
                                  não é uma tabela de junção N-N)
User     1 ───── N Document     (documentos enviados pelo usuário)
User     1 ───── N RefreshToken
```

Por que `Application.candidateId` aponta para `User` e não direto para
`CandidateProfile`: a identidade usada em autenticação/autorização é sempre
o `User` (é o que sai do JWT via `@CurrentUser()`). `CandidateProfile` é uma
tabela de detalhe 1-1, não deve ser o ponto de ancoragem de FKs de outras
entidades — evita um `join` a mais só para checar "esse candidato é dono
desta candidatura?".

## 2. Regras obrigatórias → como aparecem no schema

| Regra (AV-04) | Onde é garantida |
|---|---|
| Candidatura duplicada proibida | `@@unique([candidateId, jobId])` em `Application` |
| Vaga inativa não aceita candidatura | `Job.status` (enum `JobStatus`); checagem no Service antes de criar `Application` (Fase 2/3) |
| Recruiter só opera vagas da própria empresa | `User.companyId` vs `Job.companyId`; comparação no Service/Guard (Fase 2), não é uma constraint de banco |
| Referência a recurso inexistente tratada | FKs obrigam existência; Service converte erro de FK/`findUnique` ausente em `404` (Fase 2) |
| Transições de status coerentes | `JobStatus`, `ApplicationStatus`, `InterviewStatus` como enums fechados; máquina de estados validada no Service (Fase 3) |
| Histórico quando necessário | `ApplicationStatusHistory` (append-only, sem `updatedAt` — é log, não é editado) |
| Dados sensíveis fora da resposta | `User.password` nunca serializado (Fase 2: DTO de resposta / `class-transformer`) |
| Operação pessoal usa identidade autenticada | `candidateId` de `Application` deve vir de `@CurrentUser()`, nunca do body (Fase 2) |
| Usuário não manipula recurso de terceiro via ID (aplicado a upload) | `Application.resumeDocumentId` não tem como o schema garantir sozinho que o documento referenciado pertence ao mesmo candidato — **regra obrigatória do Service (Fase 2)**: validar `resumeDocument.ownerId === candidateId` antes de aceitar. Achado da auditoria Qwen rodada 2 (C6) |

## 3. Concorrência (lição da avaliação anterior)

`Job.vacancies` (total de vagas) e `Job.filledCount` (quantas já foram
preenchidas) existem para suportar a regra: **duas candidaturas não podem
"ganhar" a última vaga ao mesmo tempo**.

Fluxo planejado para a Fase 3 (ainda não implementado):

```text
transição Application → HIRED
   ↓
$transaction (isolationLevel: Serializable OU SELECT ... FOR UPDATE no Job)
   ↓
recarrega Job dentro da transação com lock de linha
   ↓
filledCount < vacancies ?
   ├─ não → 409 (vaga já preenchida)
   └─ sim → filledCount += 1
             se filledCount === vacancies → status = FILLED
             Application.status = HIRED
             grava ApplicationStatusHistory
   ↓
commit
```

Isso será testado com `Promise.all` disparando N requisições de contratação
simultâneas para uma vaga com `vacancies = 1` (Fase 3 / `test/concurrency.spec.ts`).

**Camada extra decidida (achado válido da auditoria Qwen rodada 2, C1):** a
transação com lock é a defesa primária, mas nada no banco impede hoje um
`UPDATE` direto (bypassando a aplicação) de deixar `filledCount > vacancies`.
Vamos adicionar, na migration da Fase 3, `CHECK (filledCount <= vacancies)`
e `CHECK (filledCount >= 0)` como rede de segurança adicional — não é
sintaxe nativa do `schema.prisma` (Prisma ainda não tem `@check` declarativo
estável), então entra como SQL editado à mão na migration gerada.

## 4. Matriz de permissões (proposta inicial — validar com DeepSeek)

| Ação | CANDIDATE | RECRUITER (dono da empresa) | RECRUITER (outra empresa) | ADMIN |
|---|---|---|---|---|
| Criar empresa | – | – | – | ✅ |
| Criar/editar vaga da própria empresa | – | ✅ | ❌ (403) | ✅ |
| Editar vaga de outra empresa | – | ❌ (403) | ❌ (403) | ✅ |
| Ver detalhe de vaga | ✅ (pública) | ✅ | ✅ | ✅ |
| Candidatar-se a vaga | ✅ | – | – | – |
| Ver candidaturas da própria vaga | – | ✅ | ❌ (403) | ✅ |
| Ver as próprias candidaturas | ✅ (só as suas) | – | – | ✅ |
| Mudar status de candidatura | – | ✅ (só de vaga da própria empresa) | ❌ | ✅ |
| Agendar entrevista | – | ✅ (própria empresa) | ❌ | ✅ |
| Upload de currículo | ✅ (só o próprio) | – | – | – |
| Gestão de usuários | – | – | – | ✅ |

Esta tabela é ponto de partida — pedir ao DeepSeek para revisar casos de
borda (ex.: ADMIN pode se candidatar? Recruiter pode ver perfil completo do
candidato antes de aceitar a candidatura?).

## 5. Fluxos de estado propostos

```text
Job:      DRAFT → OPEN → (PAUSED ⇄ OPEN) → FILLED
                      └────────────────→ CLOSED
                      └────────────────→ CANCELED

Application: PENDING → UNDER_REVIEW → INTERVIEW → OFFERED → HIRED
                  └───────────────────────────────────────→ REJECTED
             PENDING/UNDER_REVIEW/INTERVIEW → WITHDRAWN (pelo candidato)

Interview: SCHEDULED → COMPLETED
                    └→ CANCELED
                    └→ RESCHEDULED (gera novo registro ou atualiza data — decidir na Fase 3)
                    └→ NO_SHOW
```

Transições inválidas (ex.: `HIRED → PENDING`, agir sobre `Application` de
vaga `CLOSED`) devem virar `409` no Service (Fase 3).

## 5.1 Adendo — requisito adicional do avaliador (não está no enunciado escrito)

O professor recomendou verbalmente usar **API key junto com o token JWT**.
Isso não está no `AV-04-RECRUTAMENTO.md`, mas como veio de quem avalia, vira
requisito de fato — registrado aqui para o histórico do projeto.

**Verificação de conformidade com o enunciado (antes de aceitar qualquer
adição):** "autorização por papel/permissão" já é item obrigatório do
`AV-04-RECRUTAMENTO.md` — RBAC dinâmico não é escopo extra, é uma forma mais
robusta de cumprir esse item. "Segurança" é uma das 8 dimensões
explicitamente avaliadas no enunciado — uma camada adicional (API key) não
contraria nenhuma linha do documento. Nenhuma das decisões abaixo substitui,
enfraquece ou entra em conflito com um requisito obrigatório; são adições
dentro do que já é observado/pedido.

**Decisões tomadas (Fase 1, revisão de escopo):**

1. **API key como camada adicional, não substituta do JWT.** Um guard global
   (`APP_GUARD`) vai checar um header (`x-api-key`) contra um valor vindo do
   `.env`, **diferente por ambiente** (dev/test/produção), antes mesmo de
   chegar no `JwtAuthGuard`. Ela identifica "este é um cliente conhecido",
   não "quem é o usuário" — essa segunda pergunta continua sendo só do JWT.
   **Correção de rótulo (achado válido da auditoria Qwen rodada 2, C8):**
   isto é **defesa em camadas** (defense in depth), não "Zero Trust" — um
   valor único e estático, igual para todo cliente, sem identidade própria,
   sem expiração e sem revogação individual é um *shared secret*, não uma
   verificação contínua por identidade. Mantemos a camada (é o que o
   avaliador pediu), mas documentamos a limitação real: (a) ela não
   distingue qual cliente está chamando, só que "conhece o segredo"; (b)
   **decisão resolvida (CE-1, `CONDICOES-ENTRADA-FASE2.md`):** o consumidor
   desta API é sempre um cliente confiável — Postman, Swagger UI, curl,
   Thunder Client, o próprio avaliador — **não existe frontend/SPA no
   escopo desta avaliação**. Por isso a API key pode ser exigida
   globalmente, sem lista de rotas isentas, inclusive em `/auth/login` e na
   listagem pública de vagas. Se um frontend for adicionado no futuro como
   melhoria (`FEEDBACKS-MELHORIA.md` #10), esta decisão precisa ser
   revisitada antes — não é compatível com um cliente rodando no navegador;
   (c) precisa comparação em tempo constante e nunca
   aparecer em log (redigir o header em qualquer logger). O modelo com
   entidade própria (`ApiKey` com hash, expiração, revogação por cliente) é
   o caminho correto para produção real — registrado como melhoria em
   `FEEDBACKS-MELHORIA.md` #6, não implementado agora por custo/prazo.
   **Política de precedência 401 (achado do DeepSeek + Qwen C8):** falta ou
   invalidade da API key → `401`; falta ou invalidade do JWT → `401`;
   autenticado mas sem a permission key necessária → `403`; autenticado,
   com permissão, mas recurso não pertence a ele → `404`; regra de negócio
   violada → `409`. Isso vale inclusive para `/auth/login` (sem API key
   válida → `401` antes mesmo de checar as credenciais).
2. **RBAC dinâmico via banco, nos dois níveis, dentro do escopo principal da
   Fase 2** (`Role`, `Permission`, `RolePermission`), substituindo o `enum
   Role` fixo do desenho original — ver o schema atualizado abaixo. Segue o
   padrão já validado no `PROJETO DEVCONNECT` (auditoria, seção 7.2), com uma
   diferença deliberada: aquele projeto não tinha nenhuma auditoria de "quem
   mudou qual permissão de qual papel" — é um ponto que o Qwen deve avaliar
   explicitamente nesta revisão (ver pergunta extra no pacote do Qwen).
   - **Nível A (cumpre o obrigatório):** seed cria os 3 papéis do enunciado
     com permissões corretas; Guards leem permissão do banco a cada request.
   - **Nível B (além do pedido, decisão explícita do engenheiro
     responsável):** endpoint de ADMIN para editar permissões de um papel em
     runtime, com proteção contra auto-bloqueio. Não é pedido pelo
     enunciado — decisão consciente de assumir o custo de tempo dentro dos 5
     dias disponíveis, para reforçar a dimensão "segurança"/"arquitetura"
     avaliada. Deve aparecer na seção "Além do que foi pedido" do README
     final, não escondido.
3. **MFA fica como bônus condicional**, não como parte do núcleo da Fase 2.
   Documentado aqui para não ficar implícito: se sobrar tempo real depois de
   todo o obrigatório + API key + RBAC dinâmico (Nível A e B), avaliamos
   implementar TOTP; caso contrário, vai para "conscientemente fora do
   escopo" no README final.

## 6. Veredito externo registrado (Fase 1)

Esta seção deixou de ser autoavaliação — registra o veredito real recebido,
não uma lista marcada por nós mesmos (achado legítimo da auditoria Qwen
rodada 2: "o documento que existe para registrar o veredito externo não
registrava o veredito").

- **DeepSeek** (negócio/infra): relatório completo entregue e incorporado —
  ver `PARECER-DEEPSEEK-FASE1.md`. Sem veredito de aprovação/reprovação
  (papel de planejamento, não de gate).
- **Qwen** (ORM/DevSecOps), rodada 2: **REPROVADO** — ver
  `PARECER-QWEN-FASE1-RODADA2.md` na íntegra. Resposta do time, item a
  item (aceito/corrigido/discordado/pendente), em
  `TRIAGEM-REVISOES-RODADA2.md`.
- Correções já aplicadas nesta rodada estão registradas como comentários no
  próprio `schema.prisma` (busca por "achado" ou "Qwen rodada 2" no
  arquivo) e detalhadas na triagem.

## 7. Lições das auditorias dos projetos anteriores

### 7.1 `refeitorio-api` (avaliação real anterior — já pós-correções)

**Pontos fortes a replicar literalmente:**

- Concorrência resolvida com `$transaction` + `` tx.$queryRaw`SELECT ... FOR UPDATE` `` lendo/escrevendo **sempre via `tx`** dentro do callback, mais um índice único como rede de segurança (`P2002` → `409`), e testado de fato com `Promise.all` de N requisições simultâneas em `test/`. É exatamente o padrão que vamos usar na Fase 3 para `Job.filledCount`/`vacancies`.
- `@CurrentUser()` sempre como fonte da identidade, nunca body/params; um `ensureOwner()` central antes de qualquer mutação.
- Senha nunca sai da API: `select` explícito sem `password` por padrão; só um método traz o hash, usado exclusivamente pelo `AuthService`.
- `PrismaService` único (`extends PrismaClient`), um só ponto de instanciação em todo o `src/`.
- `.env`/`.env.test` reais nunca versionados; `JWT_SECRET` só via `ConfigService`.
- **README modelo**: seções explícitas "Obrigatório do enunciado / Bônus do enunciado / Além do que foi pedido / Conscientemente fora do escopo" + passo a passo numerado completo + tabela de env vars + "Decisões técnicas relevantes" justificando cada trade-off não óbvio. Vamos replicar essa estrutura quase literalmente no README do recrutamento-api.

**Falhas a não repetir:**

1. Mesmo um projeto já corrigido caiu no mesmo padrão da lição #1 do master prompt: `grep -rn "include"` no projeto inteiro deu **zero resultados** — a relação `MealReservation.menu` nunca é atravessada, então `GET /meal-reservations/my` devolve `menuId` cru em vez dos dados do cardápio. Ação: no recrutamento-api, antes de fechar cada endpoint que devolve uma entidade com FK relevante para o negócio, decidir explicitamente o `include`/`select` e usar `grep -rn "include"` como checklist final, não como retrofit.
2. Ambiguidade `403` vs `404` para recurso de terceiro (`cancel` de reserva de outro usuário retorna `403`, o que vaza a existência do recurso via enumeração de IDs). Decisão: como temos 3 papéis (CANDIDATE/RECRUITER/ADMIN) e mais entidades sensíveis (candidaturas, entrevistas), vamos **decidir e documentar cedo** essa política por recurso em vez de deixar implícita.
3. Fórmula de negócio crítica duplicada em dois arquivos (service + seed) sem única fonte de verdade — risco de divergência silenciosa. Ação: qualquer regra usada tanto em runtime quanto em seed (ex.: cálculo de chave única, validação de estado) deve viver em uma função compartilhada.
4. Rate limiting em `/auth/login` foi conscientemente deixado de fora (documentado). Vamos avaliar incluir `ThrottlerGuard` no login do recrutamento-api já que a estrutura de pastas do master prompt já prevê isso em `common/guards/`.
5. O projeto não tinha upload de arquivo nem integração HTTP externa — não há precedente a copiar para essas duas áreas, que são novas nesta avaliação; tratar desde o design (Fase 2/3) com o mesmo rigor dos outros pontos: validação de tipo/tamanho vinculada a uma entidade real, e timeout/erro de API externa nunca vazando como `500`.

### 7.2 `PROJETO DEVCONNECT` (projeto de estudo)

**Pontos fortes a replicar:**

- `include`/`select` nomeados e consistentes: cada service define uma constante `as const` (ex.: `authorPreview`, `userSelect`) no topo do arquivo, sem `password`, reutilizada em todas as queries daquele domínio. É o padrão que vamos adotar para `Job`, `Application`, `CandidateProfile`.
- `ensureSelfOrAdmin`/`ensureOwner`: helper privado no Service que compara `@CurrentUser()` com o dono real do recurso **antes** de qualquer mutação — nunca confiar em ID de path/body sozinho.
- Erros de negócio nunca viram 500: `ConflictException`, `ForbiddenException`, `NotFoundException`, e até `BadGatewayException` para falha de serviço externo (em vez de 500 genérico) — modelo direto para o módulo `external/` (CEP) do recrutamento-api.
- Padrão de integração `HttpService` sólido: `firstValueFrom` + `.pipe(catchError(...))` + `Logger` + tradução de erro do upstream para exceção Nest apropriada. Vamos usar exatamente essa estrutura no `ExternalModule`.
- `JwtStrategy` revalida usuário/role no banco a cada request (evita autorização desatualizada em tokens antigos válidos).

**Falha crítica encontrada — a mais grave das duas auditorias:**

`src/main.ts` continha `console.log('JWT_SECRET recebida:', configService.get('JWT_SECRET'))` — o segredo de assinatura JWT sendo impresso no stdout a cada boot (ainda não commitado, mas a um passo de vazar via log agregado/Docker/CI). **Ação obrigatória no recrutamento-api**: antes de cada commit, `grep -rn "console.log"` em `src/` e revisão manual de que nenhuma variável sensível (`JWT_SECRET`, senha de banco, tokens de parceiro) aparece em log, resposta de erro ou stack trace.

**Outras falhas:**

- Segredos de exemplo hardcoded em `docker-compose.yml` (mesmo hábito perigoso — trocar por `env_file`/variável de ambiente do host).
- **Nenhum precedente de concorrência real no projeto**: o único caso próximo (reação a post) resolve exclusividade via `upsert` + `@@unique`, mas não há nenhum `$transaction` com lock/serializable nem teste de concorrência. Confirma que este é o maior ponto cego a treinar deliberadamente na Fase 3.
- README completamente desatualizado (descreve um estágio antigo do projeto, sem Prisma/RBAC/upload/integrações reais) — reforça a necessidade de manter o README vivo a cada fase, não só no final.
- Documentação interna (`CLAUDE.md`) desatualizada em relação ao código — lição indireta: qualquer doc de apoio (inclusive os READMEs de fase deste projeto) deve ser revalidada contra o código antes de servir de referência.

### 7.3 Síntese — top riscos a vigiar ativamente no recrutamento-api

1. **Concorrência** (nenhum dos dois projetos de estudo tem precedente sólido; o `refeitorio-api` só resolveu isso na 2ª rodada de correção) → tratar como prioridade desde a Fase 3, com `$transaction` + lock de linha + teste `Promise.all` desde o primeiro commit da regra, não como retrofit.
2. **`include`/`select` deliberado por endpoint**, com convenção nomeada (`as const`) sem campos sensíveis — replicar o padrão que já funcionou no DEVCONNECT.
3. **Nunca logar segredos** — `grep -rn "console.log"` obrigatório antes de cada commit; usar `Logger` do Nest, nunca `console.log`, em qualquer código que toque `ConfigService`.
4. **README vivo por fase**, com seções "Obrigatório / Bônus / Além do pedido / Conscientemente fora do escopo" (modelo do `refeitorio-api`) atualizado a cada funcionalidade — não escrito no final.
5. **Política 403 vs 404 para recursos de terceiros** decidida e documentada cedo, e testada com inversão de papéis entre os 3 perfis (CANDIDATE/RECRUITER/ADMIN).
