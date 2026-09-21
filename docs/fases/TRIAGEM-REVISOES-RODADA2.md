# Triagem das revisões — Qwen (rodada 2) e DeepSeek

Este documento é a resposta do time a `PARECER-QWEN-FASE1-RODADA2.md` e
`PARECER-DEEPSEEK-FASE1.md`. Cada item recebe um veredito próprio — não
aceitamos nem recusamos em bloco.

**Nota de verificação:** os commits `c8b98e1` e `38fd048` citados pelo Qwen
existem de verdade no nosso `git log` — o acesso ao repositório é real, não
alucinado. Onde a análise do Qwen é verificável contra o schema atual (a
maioria dos itens), tratamos como correta por padrão. Onde a conclusão
depende de contexto de negócio que nós definimos (ex.: por que `SetNull` em
vez de `Restrict`), aplicamos julgamento próprio em vez de aceitar por
autoridade.

## Legenda

- ✅ **ACEITO E CORRIGIDO** — já aplicado no `schema.prisma`/docs nesta rodada.
- 📋 **ACEITO, PLANEJADO** — correto, mas a correção é código (Fase 2/3), não schema.
- ⚖️ **DISCORDAMOS** — avaliado e mantido como estava, com justificativa.
- 🟡 **PENDENTE DE DECISÃO** — trade-off real, registrado em `FEEDBACKS-MELHORIA.md`.
- ⏸️ **NÃO SE APLICA AINDA** — correto como observação, mas é sobre uma fase que ainda não começou por decisão nossa, não por esquecimento.

## Falhas herdadas (rodada 1)

| ID | Item | Veredito | Detalhe |
|---|---|---|---|
| C1 | Sem `CHECK` no banco para `filledCount <= vacancies` | 📋 | `CHECK` será adicionado via SQL na migration da Fase 3, junto com o lock. Ver `FASE-1-MODELAGEM.md` §3. |
| C2 | `package.json`/`tsconfig.json`/`prisma.config.ts`/`.env.example` ausentes | ⏸️ | Fase 1 é modelagem, por decisão explícita do master prompt ("PARE antes de gerar código de serviço"). Esses arquivos nascem no início da Fase 2 (scaffolding do Nest), não antes. Não é um item esquecido. |
| C3 | `password`/`tokenHash`/`path` vazam por `include` aninhado | 📋 | Real e importante. Solução: `omit` global no `PrismaClient` (Prisma ≥5.16) cobrindo `User.password`, `RefreshToken.tokenHash`, `Document.path` — mais robusto que lembrar `select` em cada query manualmente. Vira requisito obrigatório do `PrismaService` na Fase 2. |
| C4 | "Política de deleção contraditória (Cascade × Restrict)" em `User` | ⚖️ | Não vemos contradição, vemos tratamento diferente por tipo de relação, documentado desde a Fase 1: `Cascade` só em registros que são *detalhe* do usuário e sem sentido sozinhos (`CandidateProfile`, `RefreshToken`, `Document`); `Restrict` em registros que são *histórico de negócio* (`Application`, `Job` criado, `ApplicationStatusHistory`). O mecanismo real de "remover" um usuário é `isActive = false` (soft-delete), não `DELETE` físico — por isso `Restrict` em histórico é intencional: impede apagar fisicamente um usuário com rastro de negócio. Se o Qwen tinha um cenário concreto diferente em mente, precisamos do relatório original (rodada 1) para reavaliar — não o temos neste momento. |
| C5 | `User.companyId onDelete: SetNull` "destrói invariante de autorização" | ⚖️ | Discordamos: `SetNull` é o comportamento correto aqui. Quando um recrutador perde a empresa, `companyId` vira `null`; toda checagem de autorização (`job.companyId === user.companyId`) passa a falhar fechado (nenhuma comparação com `null` autoriza nada). O `JwtStrategy` revalida contra o banco a cada request (padrão herdado do DEVCONNECT), então não há JWT "desatualizado" carregando uma `companyId` antiga. Não identificamos o caminho de exploração que o item sugere — mesma ressalva do C4, precisaríamos do relatório original completo para reavaliar com um cenário concreto. |
| C6 | `resumeDocumentId` sem checar dono; `Document.path` sem `@unique` | ✅ / 📋 | `Document.path @unique` **corrigido no schema agora**. A checagem de posse (`resumeDocument.ownerId === candidateId`) não é enforçável por FK simples no Postgres (exigiria trigger) — registrada como regra obrigatória do Service na Fase 2, em `FASE-1-MODELAGEM.md` §2. |

## Falhas novas (RBAC dinâmico + API key)

| ID | Item | Veredito | Detalhe |
|---|---|---|---|
| C7 | RBAC sem trava de autoexclusão nem auditoria; `Cascade` destrutivo | ✅ / 🟡 | `Permission → RolePermission` mudou de `Cascade` para **`Restrict`** (corrigido — apagar uma permissão em uso agora é bloqueado pelo banco). `Role.isSystem` **adicionado** como primeiro passo de proteção dos 3 papéis do enunciado. A trava de "último ADMIN" e a revogação não-destrutiva (soft-delete com `revokedAt`/autor) **ficam pendentes** — ver `FEEDBACKS-MELHORIA.md` #3 e #4. Recomendação: tratar como obrigatório do Nível B quando ele for implementado (não do Nível A). |
| C8 | API key sem modelo próprio; rótulo "Zero Trust" incorreto; incoerente em rota pública | ✅ (rótulo) / 🟡 (modelo) | Rótulo corrigido para "defesa em camadas" em `FASE-1-MODELAGEM.md` §5.1, com a limitação documentada explicitamente (shared secret estático). Modelo próprio (`ApiKey` com hash/expiração/revogação) fica como melhoria — `FEEDBACKS-MELHORIA.md` #6 — por custo/prazo. Política de precedência 401 (API key → JWT → permissão → dono) documentada e vale inclusive para `/auth/login`, resolvendo a ambiguidade apontada. |
| C9 | Escopo expandido sem nenhum item obrigatório implementado; veto ao Nível B agora | ✅ | Aceito integralmente. **Resequenciamento**: RBAC Nível A (seed + Guards lendo permissão do banco) entra junto com o núcleo da Fase 2, porque "autorização por papel/permissão" é item obrigatório. Nível B (endpoint de ADMIN editando permissões em runtime) **só começa depois de todo o obrigatório estar verde** — não em paralelo. MFA permanece "bônus condicional" (decisão já tomada), mas só é avaliado depois de Nível A + obrigatório + Nível B, nesta ordem. |

## Regressões

| ID | Item | Veredito | Detalhe |
|---|---|---|---|
| R1 | Perda de union type para papel (agora `string` livre) | 📋 | Mitigação: constante compartilhada `SYSTEM_ROLES` (ou similar) usada tanto pelo seed quanto por qualquer comparação de papel no código — mesma lição já registrada em `FASE-1-MODELAGEM.md` §7.1 (fórmula duplicada em dois lugares no `refeitorio-api`). Vira requisito da Fase 2. |
| R2 | Custo de consulta extra por request sem cache | 🟡 | Já registrado em `FEEDBACKS-MELHORIA.md` #2. Sem cache é aceitável para o volume da avaliação. |
| R3 | `RolePermission` sem `@@index([permissionId])` | ✅ | Corrigido no schema. |
| R4 | Edição de permissões sem lock/versão (Nível B) | 📋 | Vira requisito do Nível B quando ele for implementado (ver C9 — só depois do obrigatório). |
| R5 | `Role`/`Permission` colidem com palavras reservadas do Postgres | ✅ | `@@map("app_roles")`, `@@map("app_permissions")`, `@@map("app_role_permissions")` adicionados. |

## Ressalvas herdadas

| Item | Veredito | Detalhe |
|---|---|---|
| Índices compostos faltando | ✅ | `Job(companyId, status)`, `Application(jobId, status)`, `RefreshToken.expiresAt`, `Document(ownerId, type)` adicionados; índices redundantes removidos. |
| `updatedAt` sem `DEFAULT` no DDL | ⚖️ | Só importa para `INSERT` via SQL bruto fora do Prisma Client — não é o nosso fluxo normal (seed também usa o Client). Risco real, mas baixo; sem ação agora. |
| `sizeBytes Int` risco de overflow | ⚖️ | Limite de tamanho de upload será imposto na validação do Multer/DTO (Fase 2), bem abaixo do limite do `Int` (2 GiB). Não é um risco prático para currículo/documento. |
| `.env.example` ausente | ⏸️ | Mesmo caso do C2 — nasce no início da Fase 2. |
| Doc: "Document N──N Application" | ✅ | Corrigido para 1─N em `FASE-1-MODELAGEM.md`. |
| Doc: README citando `docker/` como já reservado | ✅ | Reformulado para deixar claro que a pasta só aparece no Git quando tiver conteúdo real (Fase 4). |
| §6 não registrava veredito externo | ✅ | Seção reescrita — ver `FASE-1-MODELAGEM.md` §6. |

## Sugestões de melhoria (Qwen) — destino

Todas já capturadas em `FEEDBACKS-MELHORIA.md`: trava de último admin (#3),
revogação não destrutiva (#4), `omit` global (parte do item C3 acima, virou
requisito de Fase 2, não "melhoria opcional"), comparação em tempo
constante + redação de header para API key (nota adicionada em
`FASE-1-MODELAGEM.md` §5.1).

## Resumo para decisão

Os únicos pontos que ainda dependem de uma escolha sua (custo vs. robustez)
estão em `FEEDBACKS-MELHORIA.md`: #3 (trava de último admin no banco), #4
(revogação não destrutiva de permissão) e #6 (tabela própria de API key).
Todo o resto já foi corrigido no schema/docs ou tem destino definido
(Fase 2/3, ou "não se aplica ainda" com justificativa).
