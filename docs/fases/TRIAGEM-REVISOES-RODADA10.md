# Triagem das revisões — Qwen rodada 10 (Fase 3, CandidateProfile)

Resposta do time a `PARECER-QWEN-FASE3-CANDIDATEPROFILE-RODADA10.md`.
Mesma legenda: ✅ aceito e corrigido · 📋 aceito, planejado pra fase futura
· ⏸️ registrado, sem ação agora · ⚖️ discordamos.

## Críticos — corrigidos nesta rodada

| ID | Item | Veredito | Correção |
|---|---|---|---|
| C1 | Recrutador de empresa desativada lia perfil completo (telefone, resumo, endereço) | ✅ | `getByUserId()` ganhou a checagem de `company.isActive` do chamador (mesmo padrão de `assertCompanyActiveOrThrow` em Jobs), lançando `404` (não `403`) antes de consultar `Application`. Testado: recrutador com candidatura `UNDER_REVIEW` lia completo antes; depois de `ADMIN` desativar a empresa dele, mesma chamada → `404`. Reproduzido manualmente contra o servidor de dev, replicando o controle exato do relatório (`POST /jobs` já dava `404`, `GET /candidates/:userId` continuava `200` — agora os dois dão `404`). |
| C2 | `REJECTED`/`WITHDRAWN` destravavam perfil completo | ✅ | Predicado trocado de negação (`status !== PENDING`) para lista positiva nomeada (`STATUSES_THAT_UNLOCK_FULL_PROFILE = [UNDER_REVIEW, INTERVIEW, OFFERED, HIRED]`). Testado por status: `PENDING`/`REJECTED`/`WITHDRAWN` → reduzido; `UNDER_REVIEW`/`INTERVIEW`/`OFFERED`/`HIRED` → completo. Reproduzido manualmente: candidatura mudada pra `WITHDRAWN` contra o servidor de dev → recrutador passou a ver só `{id, name, headline, skills}`, sem `phone`/`summary`. |

## Obrigatórias — corrigidas nesta rodada

| ID | Item | Veredito | Correção |
|---|---|---|---|
| P4 | `409` espúrio em `upsert` concorrente (37,5% das requisições em N=8) | ✅ | `upsertMine()` agora captura `P2002` especificamente e reexecuta como `update` simples (a linha certamente existe, foi ela que causou a colisão) — nunca propaga o conflito pro usuário que só está editando o próprio perfil. `CandidateProfile_userId_key` adicionada a `CONSTRAINT_REASONS` como rede de segurança, caso o retry também colida (extremamente improvável). Testado: 8 `PATCH /candidates/me` simultâneos do mesmo usuário → 8×`200`, `count()` da tabela confirma exatamente 1 linha. |
| Ressalva 5 | Suíte dependia do ViaCEP vivo (2 falhas em ~9 execuções medidas pelo Qwen) | ✅ | Asserção estrita (`city === 'São Paulo'`) trocada por verificação de contrato (`201`/`200`, CEP salvo, `city` é `string` ou `null`) em `companies.e2e-spec.ts` e `candidate-profile.e2e-spec.ts`. O enriquecimento determinístico continua coberto por `cep.service.spec.ts` (mock de sucesso e de timeout, já existente desde o módulo Companies). |
| — | Teste de escopo cross-tenant | ✅ | Novo teste: mesmo candidato com `PENDING` numa empresa e `UNDER_REVIEW` noutra — cada recrutador vê exatamente o que devia, sem contaminação. |

## Ressalvas — destino

| ID | Item | Veredito | Detalhe |
|---|---|---|---|
| 1 | Falha de CEP em UPDATE apagava endereço existente | ✅ | `isResolvedAddress()` novo em `cep.service.ts` — `update()` só sobrescreve `street/city/state` se a consulta resolveu algo; em falha, mantém os valores anteriores. Corrigido em `CandidateProfileService.upsertMine()` **e** `CompaniesService.update()` (mesmo padrão, apontado pelo Qwen como presente nos dois). |
| 2 | `skills[]` sem `@MaxLength` por item | ✅ | `@MaxLength(60, { each: true })` adicionado ao DTO. |
| 3 | Perfil de usuário desativado continua legível | ⚖️ | Decisão consciente, registrada em comentário no código: histórico de processos em andamento não deve desaparecer só porque o candidato desativou a própria conta — só o LOGIN dele é bloqueado, não a visibilidade do perfil pra quem já tem relação (dono/ADMIN/recrutador com candidatura). |
| 4 | Corpo do `413` fora do padrão | 📋 | Registrado em `FEEDBACKS-MELHORIA.md` — vem do body-parser do Express, fora do `GlobalExceptionFilter`; corrigir exigiria um handler de erro dedicado no `main.ts`, fora do escopo desta rodada. |
| 6 | README §2.1 subestimava "consultas por relacionamento" | ✅ | Atualizado — `GET /jobs*` já traz `company`, e a visibilidade de `CandidateProfile` atravessa `Application → Job → Company`. |
| 7 | `GET /candidates/me` antes do primeiro `PATCH` devolve `404` | ⏸️ | Decisão de UX, mantida como está — contratualmente correto e documentado. |
| 8 | Herdadas (N1 do `roleName`, rate limiting, pool do `pg`, `CHECK`, `crypto.scrypt`, NFC, `familyId`, CI mínimo, trigger `companyId NOT NULL`) | 📋 | Sem mudança — já rastreadas em `CONDICOES-ENTRADA-FASE2.md`/`FEEDBACKS-MELHORIA.md`. |

## Observação registrada, não corrigida nesta rodada

A decisão de escopo (`companyId === null` → sem acesso; ADMIN → acesso
total) está **duplicada** entre `JobsService` (extraída em
`isAdmin()`/`hasJobScope()`) e `CandidateProfileService` (inline). O
Qwen apontou isso como o mesmo padrão que causou o C1 original (rodada
8: a mesma pergunta respondida de formas diferentes em módulos vizinhos).
Registrado como item a resolver **quando um terceiro módulo (`Application`)
precisar da mesma checagem** — extrair um helper compartilhado
(`src/common/`) nesse momento, em vez de duplicar uma terceira vez.

## Verificação

Build limpo · lint 0 avisos · `npm test` 4/4 · `npm run test:e2e`
**75/75 (79 no total)**, rodado 3× seguidas sem falha · os dois críticos
(C1, C2) reproduzidos manualmente contra o servidor de dev, replicando
exatamente os cenários do relatório do Qwen.
