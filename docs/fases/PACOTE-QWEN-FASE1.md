# Pacote para revisão — Qwen (QA Lead & DevSecOps) — Fase 1

Cole este documento inteiro na conversa com o Qwen.

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

## Checklist que você deve aplicar (Gate da Fase 1)

- [ ] Todas as FKs têm `onDelete` definido e a escolha faz sentido de negócio
      (não é só "Cascade em tudo")?
- [ ] Todos os modelos têm campos de auditoria (`createdAt`, e `updatedAt`
      quando o registro é mutável — modelos append-only como log de
      histórico não precisam de `updatedAt`, isso é intencional)?
- [ ] A regra "candidatura duplicada proibida" tem constraint única real no
      banco (não só checagem no Service)?
- [ ] As relações modeladas realmente serão úteis para os endpoints previstos
      (ex.: uma candidatura precisa trazer dados da vaga e da empresa —
      o modelo permite isso com um único `include` bem desenhado)?
- [ ] Os enums de estado (`JobStatus`, `ApplicationStatus`, `InterviewStatus`)
      cobrem os fluxos descritos sem estados ambíguos ou faltantes?
- [ ] Os campos `vacancies`/`filledCount` em `Job` são suficientes para
      suportar uma transação com lock de linha que impeça duas contratações
      simultâneas de estourarem o número de vagas?
- [ ] Existe algum campo sensível (senha, hash, token) que poderia vazar por
      estar em um relacionamento incluído sem `select` explícito?

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

enum Role {
  CANDIDATE
  RECRUITER
  ADMIN
}

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
  role      Role     @default(CANDIDATE)
  isActive  Boolean  @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  // Recrutador pertence a uma empresa. Regra "recruiter só opera vagas da
  // própria empresa" é reforçada no Service comparando este campo com o
  // companyId da vaga — o schema só garante a integridade referencial.
  companyId Int?
  company   Company? @relation("CompanyRecruiters", fields: [companyId], references: [id], onDelete: SetNull)

  candidateProfile CandidateProfile?
  documents        Document[]
  applications     Application[]         @relation("CandidateApplications")
  statusChanges    ApplicationStatusHistory[] @relation("StatusChangedBy")
  interviewsGiven  Interview[]           @relation("Interviewer")
  createdJobs      Job[]                 @relation("JobCreatedBy")
  refreshTokens    RefreshToken[]

  @@index([role])
  @@index([companyId])
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

  @@index([companyId])
  @@index([status])
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
  @@index([jobId])
  @@index([candidateId])
  @@index([status])
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
  path         String

  applications Application[]

  createdAt    DateTime     @default(now())

  @@index([ownerId])
}
```

## O que eu preciso de você

Emita um **relatório de aprovação ou reprovação detalhado**, no formato:

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

Traga de volta este relatório para eu ajustar o schema antes de avançarmos.
