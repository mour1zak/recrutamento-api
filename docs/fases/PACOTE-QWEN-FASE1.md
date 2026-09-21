# Pacote para revisão — Qwen (QA Lead & DevSecOps) — Fase 1, Rodada 3

Cole este documento inteiro na conversa com o Qwen. Esta é a **reapresentação**
pedida na sua auditoria da rodada 2 (veredito: REPROVADO). O time processou
seu relatório item a item — resposta completa em `TRIAGEM-REVISOES-RODADA2.md`
do repositório (commit mais recente). Resumo do que mudou desde então, antes
do checklist:

**Corrigido no schema (aceito integralmente):**
- C7 — `Permission → RolePermission`: `Cascade` virou `Restrict` (apagar uma
  permissão em uso agora é bloqueado pelo banco, não revoga em cascata).
- C6 — `Document.path` agora é `@unique`.
- R3 — `@@index([permissionId])` adicionado em `RolePermission`.
- R5 — `@@map` em `Role`/`Permission`/`RolePermission` (evita colisão com
  palavras reservadas do Postgres).
- `Role.isSystem` adicionado (primeiro passo de proteção dos 3 papéis do
  enunciado contra rename/exclusão).
- Índices compostos substituindo os isolados: `Job(companyId, status)`,
  `Application(jobId, status)`, `Document(ownerId, type)`,
  `RefreshToken.expiresAt`.
- `Interview.previousInterviewId` (reagendamento vira novo registro, não
  edita in-place — vindo do parecer do DeepSeek).

**Planejado, não é schema (aceito, vira código na Fase 2/3):**
- C1 — `CHECK (filledCount <= vacancies)` entra via SQL na migration da
  Fase 3, junto com a transação com lock. Não é sintaxe nativa do
  `schema.prisma`.
- C3 — vazamento de `password`/`tokenHash`/`path` por `include` aninhado:
  mitigação via `omit` global no `PrismaClient` (Fase 2), não schema.
- C6 (parte 2) — checagem de que `resumeDocument.ownerId === candidateId`
  vira regra obrigatória do Service (não expressável só com FK).
- C8 — rótulo "Zero Trust" corrigido para "defesa em camadas" nos docs; API
  key segue sem modelo de dados próprio por decisão de custo/prazo (ver
  `FEEDBACKS-MELHORIA.md` #6), com a limitação documentada.
- C9 — aceito: RBAC Nível B (endpoint de ADMIN editando permissões em
  runtime) foi resequenciado para **depois** de todo o obrigatório estar
  verde, não mais em paralelo.

**Mantido como estava, com justificativa (não aceito, defendido):**
- C4 — política de deleção de `User` não é vista como contraditória:
  `Cascade` só em registros-detalhe sem sentido próprio
  (`CandidateProfile`/`RefreshToken`/`Document`), `Restrict` em histórico de
  negócio (`Application`/`Job`/`ApplicationStatusHistory`). Remoção de
  usuário é via `isActive = false`, não `DELETE` físico.
- C5 — `User.companyId onDelete: SetNull` mantido: autorização falha
  fechada quando `companyId` é `null`, e `JwtStrategy` revalida contra o
  banco a cada request (sem JWT desatualizado carregando `companyId`
  antigo). Se você tinha um cenário de exploração específico em mente,
  descreva-o — não temos o relatório original da rodada 1 completo para
  reavaliar sem mais contexto.

**Não é falha, é sequência de fases (C2, `.env.example`):** `package.json`,
`tsconfig.json`, `prisma.config.ts` e `.env.example` ainda não existem
porque a Fase 1 é modelagem apenas, por decisão explícita do processo do
projeto — nascem no primeiro passo da Fase 2 (scaffolding do Nest), que
ainda não começou. Não avalie isso como item da Fase 1.

---

Você é o **QA Lead / DevSecOps Specialist** de um projeto NestJS + Prisma
7.10.0 + PostgreSQL: uma API de Plataforma de Recrutamento (avaliação
técnica de 5 dias). Seu papel é **auditor**, não gerador de código: você
revisa, critica, aponta falhas e tem poder de veto. Não proponha código de
feature — aponte o que está errado/faltando e por quê.

Nesta Fase 1 (Fundamentação e Modelagem), execute a **LENTE 1 (ORM)** do seu
protocolo de abertura sobre o `schema.prisma` proposto abaixo.

## Contexto: erros da avaliação anterior que NÃO podem se repetir

1. Relações declaradas no schema mas nunca atravessadas via `include`/`select`
   nas queries reais (endpoints retornando só IDs onde deveriam trazer dados
   aninhados).
2. Falta de lock/transação em operações de "checar disponibilidade antes de
   criar" sobre recurso com quantidade limitada (aqui: vagas de uma `Job`).
3. Segredos vazando em log (`console.log` de `JWT_SECRET`, por exemplo).
4. Autorização confiando em ID de body/params em vez do usuário autenticado.
5. Erro de negócio (duplicidade, estado inválido) virando `500` em vez de
   `400`/`404`/`409`.

## Mudança de escopo desde a proposta original (avaliador pediu)

O avaliador (fora do enunciado escrito) recomendou usar **API key junto com
o JWT**. Decisão tomada: API key como guard global (camada "cliente
conhecido", antes do JWT), sem substituir o JWT (camada "quem é o
usuário"). Além disso, o modelo de autorização deixou de ser um `enum Role`
fixo e virou **RBAC dinâmico via banco** (`Role`, `Permission`,
`RolePermission`), incluindo um endpoint de ADMIN para editar permissões em
runtime — inspirado no projeto `PROJETO DEVCONNECT` já auditado
anteriormente. Avalie especificamente se essas duas adições são coerentes
com o restante da arquitetura e se introduzem algum risco novo.

## Checklist — o que ainda está genuinamente em aberto

Os itens do checklist original com resposta já dada nesta rodada (FKs,
auditoria, `@@unique` de candidatura, `RolePermission` sem `updatedAt`, API
key como `APP_GUARD` global) não estão repetidos aqui — ver o resumo acima
e o schema abaixo. O que resta para o seu parecer:

- [ ] As correções aplicadas (Restrict em vez de Cascade, `isSystem`,
      índices, `@map`) resolvem de fato os pontos C6/C7/R3/R5, ou ainda
      falta algo?
- [ ] A trava de "último administrador" e a revogação não-destrutiva de
      permissão (soft-delete com autor) ficaram como pendência decidida
      (`FEEDBACKS-MELHORIA.md` #3/#4), não implementadas agora — isso é
      aceitável para a Fase 1/2, ou você mantém como bloqueio?
- [ ] A política de precedência 401 documentada (API key ausente/inválida →
      401; JWT ausente/inválido → 401; sem permission key → 403; recurso de
      terceiro → 404; regra de negócio → 409) resolve a ambiguidade que
      você apontou em C8?
- [ ] Sobre C4 e C5: a justificativa de negócio dada é suficiente, ou existe
      um cenário concreto de exploração que a nossa resposta não cobre?
- [ ] Os enums de estado (`JobStatus`, `ApplicationStatus`, `InterviewStatus`)
      cobrem os fluxos descritos sem estados ambíguos ou faltantes? (Fluxos
      atualizados pelo DeepSeek em `PARECER-DEEPSEEK-FASE1.md` §3.)

## Schema proposto

```prisma
generator client {
  provider = "prisma-client"
  output   = "../src/generated/prisma"
}

datasource db {
  provider = "postgresql"
}

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

enum JobStatus {
  DRAFT // criada, ainda não visível/aberta para candidaturas
  OPEN // aberta, aceita candidaturas
  PAUSED // temporariamente fechada para novas candidaturas, pode reabrir
  FILLED // todas as vagas (vacancies) foram preenchidas
  CLOSED // encerrada definitivamente sem preencher todas as vagas
  CANCELED // cancelada pela empresa
}

enum ApplicationStatus {
  PENDING
  UNDER_REVIEW
  INTERVIEW
  OFFERED
  HIRED
  REJECTED
  WITHDRAWN
}

enum InterviewStatus {
  SCHEDULED
  COMPLETED
  CANCELED
  RESCHEDULED
  NO_SHOW
}

enum DocumentType {
  RESUME
  COVER_LETTER
  CERTIFICATE
  OTHER
}

// ---------------------------------------------------------------------------
// User & perfis
// ---------------------------------------------------------------------------

model User {
  id        Int      @id @default(autoincrement())
  name      String
  email     String   @unique
  password  String
  isActive  Boolean  @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  // RBAC dinâmico: o papel é uma linha em `Role`, não um enum fixo. O seed
  // sempre cria CANDIDATE/RECRUITER/ADMIN com permissões coerentes; um ADMIN
  // pode ajustar permissões em runtime via RolePermission.
  roleId    Int
  role      Role     @relation(fields: [roleId], references: [id], onDelete: Restrict)

  // Recrutador pertence a uma empresa. Regra "recruiter só opera vagas da
  // própria empresa" é reforçada no Service comparando este campo com o
  // companyId da vaga — o schema só garante a integridade referencial.
  // onDelete SetNull mantido de propósito (ver resposta a C5 acima).
  companyId Int?
  company   Company? @relation("CompanyRecruiters", fields: [companyId], references: [id], onDelete: SetNull)

  candidateProfile CandidateProfile?
  documents        Document[]
  applications     Application[]         @relation("CandidateApplications")
  statusChanges    ApplicationStatusHistory[] @relation("StatusChangedBy")
  interviewsGiven  Interview[]           @relation("Interviewer")
  createdJobs      Job[]                 @relation("JobCreatedBy")
  refreshTokens    RefreshToken[]

  @@index([roleId])
  @@index([companyId])
}

// ---------------------------------------------------------------------------
// RBAC dinâmico (papéis e permissões via banco, não enum fixo)
// ---------------------------------------------------------------------------

model Role {
  id          Int              @id @default(autoincrement())
  name        String           @unique // ex.: "CANDIDATE", "RECRUITER", "ADMIN"
  description String?
  // Novo (rodada 3): protege os 3 papéis do enunciado contra rename/exclusão
  // acidental pelo endpoint de ADMIN (Nível B).
  isSystem    Boolean          @default(false)

  users           User[]
  rolePermissions RolePermission[]

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@map("app_roles")
}

model Permission {
  id          Int    @id @default(autoincrement())
  key         String @unique // ex.: "job:create", "application:status:update"
  description String?

  rolePermissions RolePermission[]

  createdAt DateTime @default(now())

  @@map("app_permissions")
}

model RolePermission {
  id           Int        @id @default(autoincrement())
  roleId       Int
  role         Role       @relation(fields: [roleId], references: [id], onDelete: Cascade)
  permissionId Int
  // Novo (rodada 3): Restrict em vez de Cascade — corrige C7. Apagar uma
  // Permission em uso agora é bloqueado pelo banco, não revoga em cascata.
  permission   Permission @relation(fields: [permissionId], references: [id], onDelete: Restrict)

  createdAt DateTime @default(now())

  // Uma permissão só pode estar associada a um papel uma vez.
  @@unique([roleId, permissionId])
  // Novo (rodada 3): corrige R3.
  @@index([permissionId])
  @@map("app_role_permissions")
}

model RefreshToken {
  id        Int       @id @default(autoincrement())
  tokenHash String    @unique
  userId    Int
  user      User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  expiresAt DateTime
  revokedAt DateTime?
  createdAt DateTime  @default(now())

  @@index([userId])
  // Novo (rodada 3): consulta de limpeza/validação de tokens expirados.
  @@index([expiresAt])
}

model CandidateProfile {
  id        Int      @id @default(autoincrement())
  userId    Int      @unique
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  headline  String?
  summary   String?
  phone     String?

  // Endereço preenchido/enriquecido via integração externa de CEP (HttpService)
  cep       String?
  street    String?
  city      String?
  state     String?

  skills    String[]

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

// ---------------------------------------------------------------------------
// Empresa & vagas
// ---------------------------------------------------------------------------

model Company {
  id          Int      @id @default(autoincrement())
  name        String
  cnpj        String?  @unique
  description String?

  // Endereço resolvido via integração externa de CEP/localização
  cep         String
  street      String?
  city        String?
  state       String?

  recruiters  User[]   @relation("CompanyRecruiters")
  jobs        Job[]

  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}

model Job {
  id          Int       @id @default(autoincrement())
  title       String
  description String
  companyId   Int
  company     Company   @relation(fields: [companyId], references: [id], onDelete: Restrict)

  createdById Int
  createdBy   User      @relation("JobCreatedBy", fields: [createdById], references: [id], onDelete: Restrict)

  status      JobStatus @default(DRAFT)
  isRemote    Boolean   @default(false)
  salaryMin   Int?
  salaryMax   Int?

  // Controle de concorrência: número total de vagas e quantas já foram
  // preenchidas. A transição de Application -> HIRED precisa checar/atualizar
  // estes dois campos dentro de uma transação com lock de linha (Fase 3),
  // para impedir que duas contratações simultâneas estourem "vacancies".
  vacancies   Int       @default(1)
  filledCount Int       @default(0)

  applications Application[]

  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
  closedAt    DateTime?

  // Novo (rodada 3): composto substitui os dois índices isolados (ressalva
  // "índices redundantes").
  @@index([companyId, status])
}

// ---------------------------------------------------------------------------
// Candidaturas, histórico e entrevistas
// ---------------------------------------------------------------------------

model Application {
  id         Int               @id @default(autoincrement())

  jobId      Int
  job        Job               @relation(fields: [jobId], references: [id], onDelete: Restrict)

  candidateId Int
  candidate   User             @relation("CandidateApplications", fields: [candidateId], references: [id], onDelete: Restrict)

  status      ApplicationStatus @default(PENDING)
  coverLetter String?

  resumeDocumentId Int?
  resumeDocument   Document?   @relation(fields: [resumeDocumentId], references: [id], onDelete: SetNull)

  statusHistory ApplicationStatusHistory[]
  interviews    Interview[]

  createdAt  DateTime          @default(now())
  updatedAt  DateTime          @updatedAt

  // Regra obrigatória: candidatura duplicada proibida.
  @@unique([candidateId, jobId])
  // Novo (rodada 3): composto substitui @@index([jobId]) isolado (já é
  // prefixo) + @@index([status]) isolado.
  @@index([jobId, status])
  @@index([candidateId])
}

model ApplicationStatusHistory {
  id            Int                @id @default(autoincrement())
  applicationId Int
  application   Application        @relation(fields: [applicationId], references: [id], onDelete: Cascade)

  fromStatus    ApplicationStatus?
  toStatus      ApplicationStatus

  changedById   Int
  changedBy     User               @relation("StatusChangedBy", fields: [changedById], references: [id], onDelete: Restrict)

  note          String?
  createdAt     DateTime           @default(now())

  @@index([applicationId])
}

model Interview {
  id              Int             @id @default(autoincrement())
  applicationId   Int
  application     Application     @relation(fields: [applicationId], references: [id], onDelete: Cascade)

  interviewerId   Int?
  interviewer     User?           @relation("Interviewer", fields: [interviewerId], references: [id], onDelete: SetNull)

  scheduledAt     DateTime
  durationMinutes Int?
  isRemote        Boolean         @default(true)
  location        String?
  meetingLink     String?

  status          InterviewStatus @default(SCHEDULED)
  feedback        String?

  // Novo (rodada 3), sugestão do DeepSeek: RESCHEDULED gera um novo
  // registro em vez de editar in-place, preservando o original como
  // histórico.
  previousInterviewId Int?      @unique
  previousInterview   Interview? @relation("InterviewReschedule", fields: [previousInterviewId], references: [id], onDelete: SetNull)
  rescheduledTo       Interview? @relation("InterviewReschedule")

  createdAt       DateTime        @default(now())
  updatedAt       DateTime        @updatedAt

  @@index([applicationId])
}

// ---------------------------------------------------------------------------
// Documentos (upload)
// ---------------------------------------------------------------------------

model Document {
  id           Int          @id @default(autoincrement())

  ownerId      Int
  owner        User         @relation(fields: [ownerId], references: [id], onDelete: Cascade)

  type         DocumentType @default(RESUME)
  filename     String
  originalName String
  mimeType     String
  sizeBytes    Int
  // Novo (rodada 3): @unique corrige C6 (colisão de caminho físico).
  path         String @unique

  applications Application[]

  createdAt    DateTime     @default(now())

  // Novo (rodada 3): composto substitui @@index([ownerId]) isolado.
  @@index([ownerId, type])
}
```

## O que eu preciso de você (Rodada 3)

Emita um **relatório de aprovação ou reprovação detalhado**, no mesmo
formato de antes:

```text
VEREDITO: [APROVADO | APROVADO COM RESSALVAS | REPROVADO]

Itens do checklist: [passou/falhou cada um, com justificativa]

Falhas críticas (bloqueiam avanço para Fase 2):
- ...

Ressalvas (não bloqueiam, mas devem ser corrigidas antes da Fase 5):
- ...

Sugestões de melhoria (opcionais):
- ...
```

Peço explicitamente: se você mantiver C4 e/ou C5 como falha crítica, inclua
o cenário concreto de exploração/quebra que motiva isso — a resposta do
time a esses dois itens está em `TRIAGEM-REVISOES-RODADA2.md` e precisa de
um caso específico para ser reavaliada, não só a reafirmação do princípio
geral. Se C2/`.env.example` aparecerem de novo como falha "desta fase",
also justifique por que isso deveria bloquear uma fase de modelagem, dado
que o scaffolding do Nest é, por decisão do projeto, o primeiro passo da
Fase 2.
