# Pacote para revisão — DeepSeek — Mapa de Endpoints (Fase 2)

Cole este documento inteiro na conversa com o DeepSeek.

---

Você é o **Estrategista / Planejador de Infraestrutura** do projeto de
Plataforma de Recrutamento (NestJS + Prisma + PostgreSQL). Já entregou a
matriz de permissões e o catálogo de 28 permission keys
(`PARECER-DEEPSEEK-FASE1.md`). Nesta etapa, antes de eu escrever os
controllers, preciso do **mapa de endpoints REST** — método, URL, permission
key exigida, body esperado e principais respostas — para cada ação do
catálogo. Isso segue o playbook de treinamento (Etapa 0.4: "criar mapa de
endpoints antes de abrir o Controller").

## O que já existe (não precisa redefinir)

```text
GET   /health                    → sem permission key, só API key (health check de processo)
POST  /auth/register             → cria CANDIDATE (sem permission key, só API key)
POST  /auth/login                → sem permission key, só API key
POST  /auth/refresh              → sem permission key, só API key
POST  /auth/logout               → requer JWT, sem permission key específica
PATCH /users/:id/deactivate      → requer JWT + permission key `user:manage`
                                    (não se autodesativa; não desativa o
                                    último ADMIN ativo — 409 nos dois casos)
```

## Correção no catálogo de permissões (avise se discordar)

O parecer anterior dizia "ADMIN recebe todas as 28 keys", mas também listava
4 exceções (ações exclusivas de candidato). Implementei com a soma
consistente: **ADMIN = 24 keys** (28 − as 4 de candidato:
`application:create`, `application:withdraw:own`,
`candidate-profile:update:own`, `document:upload:own`). Seed confirma no
banco: ADMIN=24, RECRUITER=13, CANDIDATE=8 grants.

## Catálogo completo (para mapear pra rota)

```text
company:create, company:read, company:update, company:delete
job:create, job:read, job:read:any, job:update, job:delete, job:status:update
application:create, application:read:own, application:read:job,
application:read:any, application:status:update, application:withdraw:own
candidate-profile:read, candidate-profile:update:own
interview:create, interview:read, interview:update
document:upload:own, document:read:own, document:read:application
user:read, user:manage, role:manage, apikey:manage
```

## O que preciso que você defina, por recurso

Para cada linha abaixo, preencha: **método HTTP**, **URL** (use `:id`/
`:jobId`/etc. para path params), **permission key** exigida (ou "nenhuma,
só dono do recurso" quando aplicável), **body esperado** (campos
principais, não o DTO inteiro), e **respostas principais** (200/201/400/
401/403/404/409, o que faz sentido pra cada uma).

### Empresas (`company:*`)
- Criar empresa
- Ver empresa (detalhe)
- Editar empresa
- Desativar empresa (não é delete físico — `Company.isActive`, decisão já
  tomada na Fase 1 depois do achado do Qwen sobre perda de auditoria)

### Vagas (`job:*`)
- Criar vaga
- Listar vagas (público, só `OPEN`) vs. listar vagas da própria empresa em
  qualquer status (`job:read:any`)
- Ver detalhe de uma vaga
- Editar vaga
- Mudar status da vaga (`job:status:update`) — separado de editar dados
  gerais, ou é a mesma rota com regra diferente?
- Remover vaga (`job:delete`, só ADMIN) — isso existe de verdade ou vagas
  também só são "canceladas" (`status: CANCELED`), nunca apagadas?

### Candidaturas (`application:*`)
- Candidatar-se a uma vaga
- Ver minhas candidaturas (candidato)
- Ver candidaturas de uma vaga (recrutador da empresa)
- Ver candidatura específica (qualquer papel com acesso)
- Mudar status de uma candidatura (recrutador/admin)
- Retirar candidatura (candidato)

### Perfil de candidato (`candidate-profile:*`)
- Ver meu perfil / ver perfil de um candidato (regra de camadas por status
  da candidatura, definida no parecer da Fase 1 — reaproveitar aqui)
- Editar meu perfil

### Entrevistas (`interview:*`)
- Agendar entrevista (vinculada a uma candidatura)
- Ver entrevista(s) de uma candidatura
- Atualizar entrevista (status, feedback, reagendar)

### Documentos (`document:*`)
- Upload de documento (currículo/certificado) — multipart/form-data
- Ver/baixar meus documentos
- Ver/baixar documentos de candidaturas da própria empresa (recrutador)

### Gestão de usuários (`user:*`)
- Listar usuários (admin)
- Ver usuário específico
- Desativar usuário (não é delete físico — decisão já tomada)

### RBAC dinâmico — Nível B (`role:manage`) — **só desenhar, não implementar ainda**
- Listar papéis e suas permissões
- Editar as permissões de um papel

## Formato de resposta que preciso

Uma tabela markdown por recurso, no formato:

```text
| Método | URL | Permission key | Body | Respostas |
|---|---|---|---|---|
```

Para cada rota, se houver alguma regra de "dono do recurso"/"escopo de
empresa" que não é expressável só pela permission key, anote isso na coluna
de respostas (ex.: "404 se `job.companyId !== user.companyId`").
