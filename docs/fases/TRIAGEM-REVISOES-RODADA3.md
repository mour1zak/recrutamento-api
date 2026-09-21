# Triagem das revisões — Qwen rodada 3

Resposta do time a `PARECER-QWEN-FASE1-RODADA3.md`. Mesma legenda de
`TRIAGEM-REVISOES-RODADA2.md`: ✅ aceito e corrigido · 📋 aceito, planejado
pra fase futura · ⚖️ discordamos · 🟡 pendente de decisão · ⏸️ não se aplica
ainda.

**Nota:** desta vez o Qwen retirou 2 apontamentos próprios (C2 e a leitura
de escalada de privilégio em C5) depois de testar contra o schema real —
isso é um bom sinal de que o processo de rodadas está funcionando nos dois
sentidos, não só "corrigir o que ele aponta".

## Retratações do Qwen — aceitas, nada a fazer

| Item | O que era | Por que caiu |
|---|---|---|
| C2 | Toolchain ausente = falha da Fase 1 | Ele mesmo testou: `validate`/`generate` funcionam sem esses arquivos. Vira Condição de Entrada da Fase 2. |
| C5 (parte) | "Destrói invariante de autorização" | `fail-closed` confirmado correto. A parte que sobrevive (perda de auditoria) é outro problema, tratado abaixo. |

## Achados novos — veredito

| Item | Veredito | Ação |
|---|---|---|
| `Role.isSystem` comentário falso | ✅ | Comentário corrigido no schema para não prometer proteção inexistente. |
| C5 — `Company` sem `isActive`, perde rastro de recrutador ao ser apagada | ✅ | `Company.isActive` **adicionado**, espelhando `User`. |
| C4 — remoção de `User` bifurcada (cascade silencioso vs 500) | 📋 | Vira regra de negócio da Fase 2: **nenhum endpoint de delete físico de `User`** — só desativação (`isActive=false`). Se algum caminho ainda gerar `P2003`, mapear pra `409` no filtro global de exceções (não deixar virar 500). Registrado como requisito, não como "melhoria". |
| C4 — desativação não revoga `RefreshToken` | 📋 | Requisito da Fase 2: `AuthService`/`UsersService` de desativação precisa revogar (`revokedAt = now()`) todos os refresh tokens ativos do usuário; fluxo de refresh precisa revalidar `isActive`. Testado com cenário: desativar → tentar renovar → esperar `401`. |
| C4 — arquivo físico de `Document` órfão após cascade | 🟡 | Pendente de decisão de infraestrutura de storage (Fase 2/4): quando um `Document` é apagado (via cascade de usuário), algo precisa remover o arquivo do disco também — hoje o schema só cuida do registro, não do arquivo. Registrado em `FEEDBACKS-MELHORIA.md`. |
| `Interview.previousInterviewId onDelete: SetNull` quebra cadeia em silêncio | ✅ | Trocado para `Restrict` no schema. |
| Company.cep obrigatório inconsistente com plano de falha externa | ✅ | `Company.cep` virou opcional (`String?`), coerente com "criar mesmo assim com endereço null" do plano do DeepSeek. |
| CE-1 — quem é o consumidor da API (decide se API key é global) | 🟡 → decisão pedida ao usuário nesta mensagem | Ver pergunta separada — é a única condição de entrada que exige julgamento de produto, não é technical debt. |
| CE-2 — catálogo de permissões só existe em prosa, não em código | 📋 | Vira o primeiro artefato de código da Fase 2: módulo `permissions.constants.ts` (ou similar) com as 28 keys, usado tanto pelo seed quanto pelos decorators de Guard. Não é tarefa de schema. |
| R-C1.1 — `CHECK` pega sintoma, não causa; derivar `count(HIRED)` no lock | 📋 | Vira requisito da Fase 3, junto com o `CHECK`: o teste `Promise.all` precisa assertar **as duas** invariantes (`filledCount <= vacancies` E `count(HIRED) <= vacancies`), não só uma. |
| R-C1.2 — `CHECK` sobrevive a `migrate dev` posterior? | 📋 | Vira item do "teste de fumaça de migration" sugerido pelo Qwen — Fase 2/CI. |
| R-C3.1 — `omit` global não cobre `$queryRaw` | 📋 | Regra escrita para a Fase 3: qualquer `$queryRaw` (o `FOR UPDATE`) deve selecionar só as colunas estritamente necessárias, nunca `SELECT *` de `User`/`Document`. |
| R-C7.1 — 4 exigências quando Nível B existir | ✅ já rastreado | Já estava em `FEEDBACKS-MELHORIA.md` #3/#4; a novidade é que agora tem um quinto item (caminho de "aposentadoria" de `Permission`, hoje impossível de remover uma key errada já concedida) — adicionado ao arquivo. |
| R-401.1 — precedência 401 vira tabela de teste; `WWW-Authenticate`? | 📋 | Vira parte da Fase 2 (os 10 cenários obrigatórios já cobrem 401/403/404/409). `WWW-Authenticate` no `401`: aceito, custo de uma linha — registrado como requisito. |
| Enums: `REJECTED` sobrecarregado (3 causas, 1 valor) | 🟡 | Pendente de decisão — ver `FEEDBACKS-MELHORIA.md` #7 (novo). O campo `ApplicationStatusHistory.note` já existe e pode registrar o motivo em texto livre; a pergunta é se vale estruturar isso (campo categórico) para permitir métricas de funil, ou se é aceitável para o escopo da avaliação deixar como texto livre. |
| Enums: `CANCELED` vs `RESCHEDULED` ambíguos em `Interview` | 📋 | Vira regra escrita na Fase 3 (não muda o schema): `RESCHEDULED` sempre tem `rescheduledTo` preenchido; `CANCELED` nunca tem. Documentar como invariante de negócio. |
| Falta invariante: `Interview` para `Application` `WITHDRAWN` | 📋 | Vira checagem obrigatória do Service na Fase 3 (não é FK simples de expressar). |
| `email` case-sensitive/sem trim; `cnpj` sem validação de formato | 📋 | Viram regras de DTO (`@Transform` pra lowercase/trim no email; `@Matches` no CNPJ) — Fase 2, não schema. |
| Limite de tamanho em campos de texto (`password` — bcrypt trunca em 72 bytes) | 📋 | Vira `@MaxLength` no DTO de registro/login (Fase 2) — achado genuinamente importante, bcrypt truncar silenciosamente é o tipo de bug que passa despercebido. |
| `coverLetter` (texto) vs `DocumentType.COVER_LETTER` (arquivo) | 🟡 | Pendente — ver `FEEDBACKS-MELHORIA.md` #8 (novo): decidir se os dois convivem (o candidato escolhe) ou se um é removido. |
| `updatedAt` sem `DEFAULT` no DDL | ⚖️ (mantido, mas com nota) | A triagem rodada 2 descartou como "fora do fluxo normal" — o Qwen tem razão que isso muda quando a Fase 3 escreve SQL à mão: se aquele SQL fizer algum `INSERT` fora do Prisma Client (não deveria, mas é uma migration manual), o campo pode ficar nulo. Ação: ao escrever a migration da Fase 3, adicionar `DEFAULT now()` explícito nessas colunas via SQL, fechando a lacuna de vez. |
| `skills String[]` sem índice GIN | ⏸️ | Só relevante se houver filtro por habilidade — não decidido ainda se essa funcionalidade entra no escopo. Fica registrado, sem ação até a funcionalidade existir. |
| Nomenclatura mista (`app_roles` vs `"User"`) | 🟡 | Pendente — ver `FEEDBACKS-MELHORIA.md` #9 (novo): converter tudo para snake_case via `@map`/`@@map` é uma mudança grande (toca todo o schema) só para consistência estética + evitar aspas em SQL futuro. Custo-benefício avaliado, mas não decidido. |

## Já coberto, sem mudança

`R3`, `R5`, índices compostos, correções de documentação — permanecem
corrigidos como na rodada 2, reconfirmados pelo Qwen nesta rodada.
