# Parecer — DeepSeek (Strategist & Domain Expert) — Fase 1

> Registro do retorno recebido em resposta a `PACOTE-DEEPSEEK-FASE1.md`.
> Conteúdo do DeepSeek, colado sem edição para manter o histórico de
> revisão. A triagem (o que foi aceito, ajustado ou não) está em
> `TRIAGEM-REVISOES-RODADA2.md`.
>
> **Correção registrada (achado Qwen rodada 4, R14):** este documento diz
> "49 grants" (8 + 13 + 28) em três lugares abaixo. O número correto,
> aplicado de fato no schema/seed, é **45** (8 + 13 + **24** — ADMIN não
> recebe as 4 permissões exclusivas de candidato; ver
> `TRIAGEM-REVISOES-RODADA2.md` e `CONDICOES-ENTRADA-FASE2.md`). Mantido o
> texto original abaixo sem edição, para preservar o histórico do que foi
> recebido de fato.

---

## Relatório de Estratégia — Fase 1 (Atualizado)

Atuando como Estrategista / Analista de Negócio e Planejador de Infraestrutura,
considerando a mudança de escopo: autenticação via API key + JWT e autorização
via RBAC dinâmico em banco (Role, Permission, RolePermission), com endpoint de
ADMIN para editar permissões em runtime.

### 0. Impacto da Mudança de Escopo (API Key + RBAC Dinâmico)

**0.1 API Key + JWT — como se combinam.** A API key é credencial de
cliente/aplicação; o JWT é credencial de usuário.

| Camada | Credencial | Quem usa | Onde vai |
|---|---|---|---|
| Cliente → API | API Key | Integrações externas / frontends autorizados | `X-API-Key: <key>` |
| Usuário → API | JWT | Usuário autenticado | `Authorization: Bearer <token>` |

Fluxo: toda requisição a endpoints privados exige API Key válida
(`ApiKeyGuard` global); endpoints autenticados exigem adicionalmente JWT
válido; endpoints públicos (`POST /auth/login`) exigem apenas API Key. A API
Key não substitui o JWT. Reflexo nos testes: "ausência/token inválido → 401"
se desdobra em: (a) sem API Key → 401; (b) API Key inválida → 401; (c) sem
JWT → 401; (d) JWT inválido → 401.

**0.2 RBAC Dinâmico — o que muda em relação ao enum fixo.** Permissões
passam a ser linhas em `RolePermission`; o `PermissionsGuard` passa a olhar
`request.user.permissions: string[]`, não `role`. A granularidade fina
("própria empresa", "só as suas") não é expressável só com permission keys —
exige verificação de posse no Service (RBAC controla *capacidade*, Service
controla *escopo*).

**0.3 Endpoint de ADMIN para editar permissões.**
`PATCH /roles/:roleId/permissions`, `{ keys: string[] }`, substitui o
conjunto de `RolePermission` do papel; deve invalidar sessões ativas (ou
incrementar `User.permissionsVersion`).

### 1. Matriz de Permissões — Validada com Respostas às 5 Perguntas

1. **ADMIN não pode se candidatar.** Papel puramente operacional. Se no
   futuro for necessário, a solução correta é N-N User-Role (múltiplos
   papéis por usuário), não sobrecarregar ADMIN.
2. **Visibilidade em camadas do perfil do candidato**: `PENDING` → RECRUITER
   vê `coverLetter`, nome, headline, skills, currículo; não vê telefone,
   resumo, endereço, outros documentos. A partir de `UNDER_REVIEW` → perfil
   completo + todos os documentos. Recomendação: uma única permission key
   `candidate-profile:read`, com a regra de camadas aplicada no Service (não
   duas keys separadas).
3. **RECRUITER removido da empresa**: `Job.createdById`/`companyId`
   preservados (`Restrict`); operações futuras bloqueadas por
   `job.companyId !== user.companyId`; `Interview.interviewerId` vira
   `SetNull` (histórico preservado); entrevistas `SCHEDULED` futuras devem
   ser reatribuídas por ADMIN/outro recrutador da empresa. Isso é regra de
   negócio no Service de gestão de usuários, não do RBAC.
4. **Política única: 404 para recurso de terceiro** (anti-enumeração), 403
   só quando falta a permission key, 409 para violação de regra de negócio.
5. **Fluxos de estado**: faltavam transições em `Job`, `Application` e
   `Interview` — detalhado na Seção 3.

**Matriz final** (resumo — tabela completa no relatório original): inclui
`404` explícito para tentativa de acesso a vaga/candidatura fora do escopo
do recrutador, e diferencia "ver vaga OPEN" (`job:read`) de "ver vaga em
qualquer status da própria empresa" (`job:read:any`).

### 2. Permission Keys por Papel (RBAC Dinâmico)

Catálogo de **28 permission keys** no formato `recurso:ação[:escopo]`
(ex.: `job:create`, `application:status:update`, `candidate-profile:read`,
`document:upload:own`, `role:manage`). Distribuição no seed:

- **CANDIDATE** (8): `job:read`, `application:create`,
  `application:read:own`, `application:withdraw:own`,
  `candidate-profile:read`, `candidate-profile:update:own`,
  `document:upload:own`, `document:read:own`.
- **RECRUITER** (13): `company:read`, `job:create`, `job:read`,
  `job:read:any`, `job:update`, `job:status:update`,
  `application:read:job`, `application:status:update`,
  `candidate-profile:read`, `interview:create`, `interview:read`,
  `interview:update`, `document:read:application`.
- **ADMIN** (28): todas — exceto as ações de candidato
  (`application:create`, `application:withdraw:own`,
  `candidate-profile:update:own`, `document:upload:own`, que ADMIN não
  recebe por design: se tentar, é `403`, não `404` — "papel não faz isso").

Total no seed: **49 linhas em `RolePermission`** (8 + 13 + 28).

RBAC dinâmico não expressa "própria empresa"/"só as suas" — isso é sempre
regra de negócio no Service, aplicada depois do guard de permissão.

### 3. Fluxos de Estado — Ajustados

**Job** (adiciona `FILLED → CLOSED`, `PAUSED → CANCELED`, `DRAFT → CANCELED`):

```text
DRAFT ──→ OPEN ──→ PAUSED ──→ OPEN
  │        │         │
  │        │         └──→ CANCELED
  │        ├──→ FILLED ──→ CLOSED
  │        ├──→ CLOSED
  │        └──→ CANCELED
  └──→ CANCELED
```

Regras: só `OPEN` aceita candidaturas; `FILLED` é automático quando
`filledCount === vacancies`; `CLOSED`/`CANCELED` são terminais; cancelar
vaga com candidaturas ativas (`PENDING`/`UNDER_REVIEW`/`INTERVIEW`) as vira
`REJECTED` com histórico.

**Application** (adiciona `OFFERED → REJECTED` e `OFFERED → WITHDRAWN`):

```text
PENDING ──→ UNDER_REVIEW ──→ INTERVIEW ──→ OFFERED ──→ HIRED
   │             │              │            └──→ REJECTED (recusa)
   ├──→ WITHDRAWN│              │
   ├─────────────┼──→ WITHDRAWN │
   ├─────────────┼──────────────┼──→ WITHDRAWN
   └──→ REJECTED └──→ REJECTED  └──→ REJECTED
```

`HIRED` é terminal, incrementa `Job.filledCount` em transação com lock.
`WITHDRAWN` só pelo próprio candidato. `REJECTED` por RECRUITER da empresa
ou ADMIN. `OFFERED → HIRED` verifica `filledCount + 1 > vacancies` → `409`.

**Interview**: `RESCHEDULED` gera **novo registro** (não edita in-place),
com um campo apontando para a entrevista anterior.

### 4. Plano de Seed Detalhado

- RBAC: 28 `Permission`, 3 `Role`, 49 `RolePermission`.
- Usuários: 1 ADMIN, 5 RECRUITER (3 na Empresa A, 2 na Empresa B), 6
  CANDIDATE com perfil completo. Total: 12.
- Empresas: 2, cada uma com CNPJ e CEP válidos.
- Vagas: 7, cobrindo todos os status do enum, incluindo 1 vaga
  `vacancies=1` sem candidaturas (alvo do teste de concorrência
  `Promise.all` da Fase 3).
- Candidaturas: 9, cobrindo todos os status, + 1 tentativa de duplicidade
  proposital que deve ser barrada pelo `@@unique`.
- Entrevistas: 5, uma em cada status.
- Documentos: 8 (currículos + 1 certificado + 1 carta solto).
- Histórico: gerar `ApplicationStatusHistory` refletindo a sequência real
  de transições de cada candidatura/entrevista do seed.
- API Key: 1 key de desenvolvimento (hash em banco ou env — ver decisão
  em `FEEDBACKS-MELHORIA.md` #6).

### 5. Cenários de Integração Externa (CEP/localização)

| # | Cenário | Comportamento externo | Nossa API | Status |
|---|---|---|---|---|
| 1 | CEP válido | 200 payload completo | Preenche endereço, persiste | 201 |
| 2 | CEP inexistente | 200 `{"erro": true}` | Rejeita criação | 400 |
| 3 | CEP malformado | não chamamos | DTO barra antes (`@Matches`) | 400 |
| 4 | API fora do ar | `ECONNREFUSED` | Cria sem endereço + aviso | 201 |
| 5 | Timeout | sem resposta em 3s | Cria sem endereço + aviso | 201 |
| 6 | Payload malformado | 200 JSON inválido | Loga, cria sem endereço + aviso | 201 |
| 7 | API retorna 500 | 500 | Igual ao #4 | 201 |
| 8 | API retorna 429 | 429 | Igual ao #4, com log de alerta | 201 |

Política: **criar mesmo assim, com `address: null` e aviso**, exceto CEP
explicitamente inválido (#2 → `400`). Contrato do Service:
`{status: 'ok'|'invalid'|'unavailable', ...}`.

### 6. Resumo Executivo

- API Key identifica cliente; JWT identifica usuário; ambos obrigatórios em
  rotas privadas; 401 desdobrado em 4 casos.
- RBAC: 28 keys, 3 papéis, 49 grants no seed.
- ADMIN não é candidato.
- RECRUITER só vê perfil completo a partir de `UNDER_REVIEW` (regra no
  Service).
- Política única: 404 (terceiro) / 403 (sem permission key) / 409 (regra de
  negócio).
- Fluxos de estado ajustados (Job, Application, Interview com reagendamento
  como novo registro).
- Endpoint de ADMIN de permissões deve invalidar sessões ativas.
