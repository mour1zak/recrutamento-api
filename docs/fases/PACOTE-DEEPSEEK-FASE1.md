# Pacote para revisão — DeepSeek (Strategist & Domain Expert) — Fase 1

Cole este documento inteiro na conversa com o DeepSeek.

---

Você é o **Estrategista / Analista de Negócio e Planejador de Infraestrutura**
de um projeto NestJS + Prisma + PostgreSQL: uma API de Plataforma de
Recrutamento (avaliação técnica de 5 dias, perfis CANDIDATE/RECRUITER/ADMIN).
Seu papel nesta fase é validar/refinar a matriz de permissões, os fluxos de
estado, e planejar dados de seed + cenários de teste de integração externa.
Você não escreve código — produz decisões de negócio e planejamento.

## Enunciado original (resumo fiel)

- Perfis: CANDIDATE, RECRUITER, ADMIN. Usuários não podem manipular recursos
  de terceiros apenas alterando IDs na requisição.
- Entidades mínimas: User, Company, Job, CandidateProfile, Application,
  Interview, Document.
- Regras obrigatórias: candidatura duplicada proibida; vaga inativa não
  aceita candidatura; recruiter só opera vagas da própria empresa.
- Integração externa via `HttpService` para CEP/localização da empresa
  (pode ser API mock disponibilizada pela avaliação).
- Upload obrigatório de currículo/documento, vinculado a uma funcionalidade
  real do domínio.

## Mudança de escopo desde a proposta original (avaliador pediu)

O avaliador (fora do enunciado escrito) recomendou usar API key junto com o
JWT, e a modelagem de autorização deixou de ser um `enum Role` fixo e virou
**RBAC dinâmico via banco** (tabelas `Role`, `Permission`, `RolePermission`),
com um endpoint de ADMIN para editar permissões de um papel em runtime. Isso
significa que a "matriz de permissões" abaixo agora precisa virar uma lista
de **permission keys** (ex.: `job:create`, `application:status:update`)
atribuídas a cada papel no seed — ver pedido específico na seção de Seed.

## Modelo de dados já proposto (schema Prisma, resumo textual)

```text
User (id, name, email, password, roleId -> Role, isActive, companyId?)
Role (id, name["CANDIDATE"|"RECRUITER"|"ADMIN"], description)
Permission (id, key, description)
RolePermission (roleId, permissionId) -- @@unique([roleId, permissionId])
CandidateProfile (1-1 com User: headline, summary, phone, endereço via CEP, skills[])
Company (id, name, cnpj?, endereço via CEP, recrutadores: User[], jobs: Job[])
Job (id, title, description, companyId, createdById[User],
     status[DRAFT|OPEN|PAUSED|FILLED|CLOSED|CANCELED],
     vacancies, filledCount, salaryMin/Max, isRemote)
Application (id, jobId, candidateId[User],
             status[PENDING|UNDER_REVIEW|INTERVIEW|OFFERED|HIRED|REJECTED|WITHDRAWN],
             coverLetter, resumeDocumentId?, @@unique([candidateId, jobId]))
ApplicationStatusHistory (log append-only de toda mudança de status, quem mudou)
Interview (id, applicationId, interviewerId?[User], scheduledAt,
           status[SCHEDULED|COMPLETED|CANCELED|RESCHEDULED|NO_SHOW], feedback)
Document (id, ownerId[User], type[RESUME|COVER_LETTER|CERTIFICATE|OTHER],
          filename, mimeType, sizeBytes, path)
RefreshToken (id, userId, tokenHash, expiresAt, revokedAt)
```

Regra de concorrência planejada: `Job.vacancies` e `Job.filledCount` serão
atualizados dentro de uma transação com lock de linha quando uma
`Application` passa para `HIRED`, para impedir que duas contratações
simultâneas estourem o número de vagas.

## Matriz de permissões — proposta inicial (validar/refinar)

| Ação | CANDIDATE | RECRUITER (própria empresa) | RECRUITER (outra empresa) | ADMIN |
|---|---|---|---|---|
| Criar empresa | – | – | – | ✅ |
| Criar/editar vaga | – | ✅ | ❌ 403 | ✅ |
| Editar vaga de outra empresa | – | ❌ 403 | ❌ 403 | ✅ |
| Ver detalhe de vaga | ✅ | ✅ | ✅ | ✅ |
| Candidatar-se | ✅ | – | – | – |
| Ver candidaturas da própria vaga | – | ✅ | ❌ 403 | ✅ |
| Ver as próprias candidaturas | ✅ (só as suas) | – | – | ✅ |
| Mudar status de candidatura | – | ✅ (só da própria empresa) | ❌ | ✅ |
| Agendar entrevista | – | ✅ (própria empresa) | ❌ | ✅ |
| Upload de currículo | ✅ (só o próprio) | – | – | – |
| Gestão de usuários | – | – | – | ✅ |

**Perguntas que preciso que você responda/decida:**

1. Um `ADMIN` pode se candidatar a uma vaga (agindo como candidato)? Ou
   `ADMIN` é puramente operacional/gestão?
2. Um `RECRUITER` pode ver o perfil completo do candidato (`CandidateProfile`,
   documentos) antes de a candidatura avançar para `INTERVIEW`, ou só depois
   de `UNDER_REVIEW`? Isso afeta o design de "consultas por relacionamento".
3. Quando um `RECRUITER` é removido de uma empresa (`companyId = null`), o que
   acontece com as vagas/entrevistas que ele criou/conduziu? Ficam órfãs (mas
   preservadas por `onDelete: Restrict`/`SetNull`) ou precisam ser
   reatribuídas?
4. Política de `403` vs `404` para tentativa de acessar recurso de terceiro
   (ex.: candidato tentando ver candidatura de outro candidato; recruiter de
   empresa A tentando ver vaga da empresa B): retornar `404` (não revela que
   o recurso existe) ou `403` (mais transparente, mas permite enumeração)?
   Decida uma política única e justifique — deve valer para todos os
   recursos sensíveis do sistema.
5. Fluxos de estado propostos abaixo fazem sentido de negócio? Falta algum
   estado ou transição?

```text
Job:      DRAFT → OPEN → (PAUSED ⇄ OPEN) → FILLED
                      └────────────────→ CLOSED
                      └────────────────→ CANCELED

Application: PENDING → UNDER_REVIEW → INTERVIEW → OFFERED → HIRED
                  └───────────────────────────────────────→ REJECTED
             PENDING/UNDER_REVIEW/INTERVIEW → WITHDRAWN (pelo candidato)

Interview: SCHEDULED → COMPLETED
                    └→ CANCELED
                    └→ RESCHEDULED (novo registro ou atualização in-place?)
                    └→ NO_SHOW
```

## Planejamento de Seed — o que preciso de você

**Novo, por causa do RBAC dinâmico:** defina a lista de `permission keys`
(formato `recurso:ação`, ex.: `job:create`, `job:edit:own`,
`application:status:update`, `interview:schedule`, `company:manage`,
`user:manage`, `document:upload`) e qual conjunto cada papel
(CANDIDATE/RECRUITER/ADMIN) deve ter no seed, coerente com a matriz de
permissões desta seção. Isso substitui/detalha a tabela de permissões acima
em granularidade de implementação.

Defina também um plano de dados de seed que cubra, no mínimo:

- 1 ADMIN, pelo menos 2 empresas com 2+ recrutadores cada, 5+ candidatos
  com perfil completo.
- Vagas em cada status do enum (`DRAFT`, `OPEN`, `PAUSED`, `FILLED`, `CLOSED`,
  `CANCELED`), incluindo **uma vaga com `vacancies = 1` e nenhuma candidatura
  ainda** (para o teste de concorrência da Fase 3 disparar `Promise.all`
  contra ela).
- Candidaturas cobrindo todos os status do enum, incluindo pelo menos um
  caso de tentativa de duplicidade que deve ser barrada.
- Ao menos uma entrevista em cada status.
- Documentos de currículo vinculados a candidatos.

## Cenários de teste de integração externa (CEP/localização)

A API externa pode ser mockada. Defina cenários de sucesso/falha/timeout
que o Service de `external/` (via `HttpService`) precisa tratar, por
exemplo:

- CEP válido → retorna endereço, preenche `Company`/`CandidateProfile`.
- CEP inexistente/inválido → qual resposta HTTP nossa API deve dar (400? 404?
  criar mesmo assim sem endereço?).
- API externa fora do ar (connection refused) → como devemos nos comportar
  (falhar a criação da empresa, ou criar sem endereço e permitir completar
  depois)?
- API externa demorando (timeout) → qual timeout configurar e o que
  retornar ao cliente?
- API externa retornando payload malformado → tratar sem vazar stack trace.

## O que eu preciso de volta

Um relatório com: (1) matriz de permissões validada/corrigida com as
respostas às 5 perguntas acima, (2) lista de permission keys por papel para
o RBAC dinâmico, (3) fluxos de estado confirmados ou ajustados, (4) plano de
seed detalhado (quantidades e casos), (5) tabela de cenários de integração
externa com o comportamento esperado de cada um.
