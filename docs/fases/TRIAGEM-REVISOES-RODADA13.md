# Triagem das revisões — Qwen rodada 13 (Fase 4 — APROVADO COM RESSALVAS)

Resposta a `PARECER-QWEN-FASE4-RODADA13.md`. Mesma legenda: ✅ aceito e
corrigido · 📋 aceito, planejado pra fase futura · ⏸️ registrado, sem ação
agora · ⚖️ discordamos.

## Condições pra fechar a Fase 4 — corrigidas nesta rodada

| ID | Item | Correção | Como validamos |
|---|---|---|---|
| 1 | 409 de conflito de serialização sem `reason` | Adicionado `reason: 'concorrencia_transacao'` nos **3 caminhos** que produzem esse 409 no `GlobalExceptionFilter`: o duck-typing de `isTransactionWriteConflict`, o case `P2034`/`P2028` do Prisma, e o fallback por SQLSTATE (`23505`/`23514`/`40001`/`40P01`/`55P03`/`57014`). Achado no processo: a primeira correção só cobriu o primeiro caminho — rodando a suíte 5× seguidas, 2 execuções pegaram o `reason` `undefined` porque a corrida real às vezes bate no segundo/terceiro caminho, não no duck-typing. Só ficou considerado fechado depois das 3 rotas cobertas | Testes de K2/K3 (`roles.e2e-spec.ts`, `users.e2e-spec.ts`) agora afirmam que todo `409` da corrida vem com `reason` (`concorrencia_transacao` ou o `reason` de negócio). Suíte rodada 5× seguidas sem falha depois da correção completa |
| 2 | Escopo de `Document` no mapa do DeepSeek desatualizado (ainda descrevia a regra reprovada no K6) | Adendo adicionado em `PARECER-DEEPSEEK-FASE2-ENDPOINTS.md` §6, **preservando o texto original verbatim** acima dele — registra a regra real (só `resumeDocumentId`) e o efeito colateral aceito (só `RESUME` é anexável hoje). README §5 também atualizado com a mesma nota | Revisão de texto |
| 3 | 409 de concorrência benigno em `PUT /roles/:id/permissions` não documentado | README §5, linha da rota, ganhou a menção ao `reason: "concorrencia_transacao"` como desfecho possível e seguro/retryável, ao lado do `sem_papel_com_role_manage` | Revisão de texto |

## Ressalvas "antes da Fase 5" — destino

| ID | Item | Veredito | Detalhe |
|---|---|---|---|
| 4 | Só `RESUME` é anexável (efeito colateral do K6) | 📋 | Modelo de anexos explícito (`ApplicationDocument`/`attachments`) registrado em `FEEDBACKS-MELHORIA.md` como melhoria de schema — fora do escopo de correção de bug |
| 5 | `REJECTED` remove acesso ao CV — decisão implícita | ✅ | Registrada explicitamente no README §5 (mesma linha da ressalva 2 de escopo) — mesma minimização de dados do `CandidateProfile`, decisão consciente |
| 6 | `fileParallelism: false` reduz chance de a suíte pegar interferência cruzada futura | ⏸️ | Aceito como trade-off — solução estrutural (banco por arquivo) fora do orçamento desta avaliação |
| 7 | `updateCompany` sem checar `isActive`; ciclo de vida do arquivo órfão | 📋 | Ambas herdadas da rodada 12, sem crítica nova — seguem com destino registrado em `TRIAGEM-REVISOES-RODADA12.md`, priorizadas para antes da Fase 5 |

## Verificação

Build limpo · lint 0 avisos · `npm test` 6/6 · `npm run test:e2e`
**139/139**, rodado **5× seguidas sem falha** (as 2 primeiras execuções
pós-fix-parcial pegaram exatamente o gap que motivou cobrir os 3
caminhos do `reason`) · **145 testes no total**.
