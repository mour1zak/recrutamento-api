# Pacote para revisão — Qwen (QA Lead & DevSecOps) — Fase 3: CandidateProfile, Rodada 11 (reapresentação)

Cole este documento inteiro na conversa com o Qwen.

---

Você é o **QA Lead / DevSecOps Specialist** do projeto `recrutamento-api`.
Na Rodada 10, você **reprovou** `CandidateProfile` com 2 críticos de
vazamento de PII: (C1) `getByUserId()` nunca checava se a empresa do
recrutador chamador ainda estava ativa, permitindo leitura permanente de
telefone/resumo/endereço mesmo após desativação; (C2) o predicado
`status !== PENDING` (negação) destravava o perfil completo também para
`REJECTED` e `WITHDRAWN`, sendo o caso `WITHDRAWN` o mais grave — o
candidato desistir da própria candidatura aumentava sua exposição de
dados. Relatório completo em
`PARECER-QWEN-FASE3-CANDIDATEPROFILE-RODADA10.md`; nossa resposta em
`TRIAGEM-REVISOES-RODADA10.md`. Esta é a reapresentação.

## O que foi corrigido

| Achado | Correção | Como validamos |
|---|---|---|
| **C1** (crítico) — recrutador de empresa desativada lia perfil completo | `getByUserId()` ganhou a mesma checagem de `company.isActive` já usada em Jobs (`assertCompanyActiveOrThrow`), lançando `404` antes de consultar `Application` | Recrutador com candidatura `UNDER_REVIEW` lia perfil completo antes; depois de `ADMIN` desativar a empresa dele, mesma chamada → `404`. Reproduzido manualmente contra o servidor de dev, replicando o controle exato do relatório (`POST /jobs` já dava `404`; `GET /candidates/:userId` agora também) |
| **C2** (crítico) — `REJECTED`/`WITHDRAWN` destravavam perfil completo | Predicado trocado de negação (`status !== PENDING`) para lista positiva nomeada: `STATUSES_THAT_UNLOCK_FULL_PROFILE = [UNDER_REVIEW, INTERVIEW, OFFERED, HIRED]` | Testado por status: `PENDING`/`REJECTED`/`WITHDRAWN` → reduzido; `UNDER_REVIEW`/`INTERVIEW`/`OFFERED`/`HIRED` → completo. Reproduzido manualmente: candidatura mudada pra `WITHDRAWN` contra o servidor de dev → recrutador passou a ver só `{id, name, headline, skills}` |
| P4 (obrigatória) — `409` espúrio em `upsert` concorrente (37,5% em N=8) | `upsertMine()` captura `P2002` e reexecuta como `update` simples; `CandidateProfile_userId_key` adicionada a `CONSTRAINT_REASONS` como rede de segurança | 8 `PATCH /candidates/me` simultâneos do mesmo usuário → 8×`200`, `count()` confirma exatamente 1 linha |
| Ressalva 1 — CEP em UPDATE apagava endereço existente | `isResolvedAddress()` novo em `cep.service.ts`; `update()` só sobrescreve `street/city/state` se a consulta resolveu algo. Aplicado em `CandidateProfileService` **e** `CompaniesService` (mesmo padrão nos dois) | Testado |
| Ressalva 2 — `skills[]` sem limite por item | `@MaxLength(60, { each: true })` no DTO | Revisão de código |
| Ressalva 5 — suíte dependia do ViaCEP vivo (flaky) | Asserção estrita trocada por verificação de contrato em `companies.e2e-spec.ts` e `candidate-profile.e2e-spec.ts`; enriquecimento determinístico continua coberto por `cep.service.spec.ts` (mocks) | Rodado 3× seguidas sem falha |
| — | Teste de escopo cross-tenant novo | Candidato com `PENDING` numa empresa e `UNDER_REVIEW` noutra — cada recrutador vê exatamente o que devia |

## Adiado conscientemente (registrado, sem mudança de destino)

Ressalva 3 (perfil de usuário desativado continua legível) — decisão
consciente registrada em `TRIAGEM-REVISOES-RODADA10.md`: histórico de
processos em andamento não deve desaparecer só porque o candidato
desativou a própria conta; só o LOGIN dele é bloqueado, não a
visibilidade do perfil pra quem já tem relação (dono/ADMIN/recrutador
com candidatura). Ressalva 4 (corpo do `413` fora do padrão) — vem do
body-parser do Express, fora do `GlobalExceptionFilter`; registrado em
`FEEDBACKS-MELHORIA.md` item 17, fora do escopo desta rodada. A
duplicação de lógica de escopo (`companyId`/ADMIN) entre `JobsService` e
`CandidateProfileService`, apontada por você como o mesmo padrão do C1
original — registrada para extrair um helper compartilhado quando o
módulo `Application` existir (terceiro consumidor da mesma pergunta).

## Verificação

`npm run build` limpo · `npm run lint` 0 avisos · `npm test` 4/4 ·
`npm run test:e2e` 75/75 (**79 testes no total**, 7 novos cobrindo
C1/C2/P4/cross-tenant/matriz de status) · rodado 3× seguidas sem falha ·
confirmado manualmente contra o servidor de dev reproduzindo os dois
ataques (C1 e C2) do seu relatório.

## O que eu preciso de volta

Mesmo formato de sempre. Peço em particular: (1) confirmar que a lista
positiva `STATUSES_THAT_UNLOCK_FULL_PROFILE` fecha o C2 em qualquer
transição de status que não testamos; (2) atacar o C1 de novo com mais
combinações (ex.: empresa reativada depois de desativada — o acesso
volta corretamente?); (3) opinar se a duplicação de lógica de escopo
entre Jobs e CandidateProfile já merece ser extraída agora, ou se
esperar o módulo Application é aceitável.
