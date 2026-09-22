# Triagem das revisões — Qwen rodada 11 (Fase 3, CandidateProfile — APROVADO COM RESSALVAS)

Resposta do time a `PARECER-QWEN-FASE3-CANDIDATEPROFILE-RODADA11.md`.
Mesma legenda: ✅ aceito e corrigido · 📋 aceito, planejado pra fase futura
· ⏸️ registrado, sem ação agora · ⚖️ discordamos.

## Achado novo — corrigido nesta rodada

| ID | Item | Veredito | Correção |
|---|---|---|---|
| N1 | CEP inválido e falha de rede tratados igual, permitindo `cep`×endereço inconsistente após um `update` | ✅ | `CepService.resolve()` reescrito com contrato discriminado (`status: 'ok'\|'invalid'\|'unavailable'`), exatamente como `PARECER-DEEPSEEK-FASE1.md` §5 especifica desde a Fase 1. `invalid` → `400 cep_nao_encontrado` (rejeita a operação inteira, criação e atualização); `unavailable` → preserva endereço anterior + `addressWarning` na resposta (o "+ aviso" do §5, nunca implementado antes); `ok` → sobrescreve. Aplicado em `CompaniesService.create()/update()` e `CandidateProfileService.upsertMine()`. `isResolvedAddress()` removido (redundante com `status`). Testado: `PATCH /candidates/me` com CEP inexistente → `400`, nem o `cep` nem o `phone` da mesma requisição são aplicados (rejeição da operação inteira, não parcial) — confirmado por `GET` antes/depois idênticos. Reproduzido manualmente contra o servidor de dev: CEP inválido → `400`; CEP válido → `201` com endereço enriquecido. |

## Ressalvas — corrigidas nesta rodada

| ID | Item | Veredito | Correção |
|---|---|---|---|
| 2 | `isAdmin()` duplicada verbatim em `JobsService` e `CandidateProfileService` | ✅ | Extraída para `src/common/utils/role.util.ts`, importada nos dois módulos. |
| 3 | `db:reset:test` falha em clone fresco (`ERR_MODULE_NOT_FOUND`, seed importa client gerado) | ✅ | `npx prisma generate` adicionado como primeiro comando do script. Reproduzido o erro exato (apagando `src/generated/prisma/` e rodando só `prisma db seed`, confirmando o mesmo `ERR_MODULE_NOT_FOUND` do relatório) antes de confirmar que a correção resolve — rodado de novo com sucesso. |
| 4 | README §5 descrevia o reduzido como "candidatura `PENDING`" | ✅ | Corrigido para descrever a lista positiva (`UNDER_REVIEW`/`INTERVIEW`/`OFFERED`/`HIRED` → completo; qualquer outro, incluindo `REJECTED`/`WITHDRAWN` → reduzido) e a checagem de empresa ativa. |

## Ressalvas — destino

| ID | Item | Veredito | Detalhe |
|---|---|---|---|
| 5 | Uma query a mais por leitura de perfil (`company.findUnique` separado) | ⏸️ | Baixo impacto, registrado — resolver junto se/quando o `JwtStrategy` passar a carregar `company.isActive` no mesmo carregamento do usuário. |
| 6 | Ressalvas 3/4 da rodada 10 (perfil de desativado legível; corpo do 413) | ⏸️/📋 | Sem mudança — já com decisão escrita/registro próprios (rodada 10). |
| 7 | Herdadas (N1 do `roleName`, rate limiting, pool do `pg`, `CHECK`, `crypto.scrypt`, NFC, `familyId`, CI mínimo, trigger `companyId NOT NULL`) | 📋 | Sem mudança — já rastreadas em `CONDICOES-ENTRADA-FASE2.md`/`FEEDBACKS-MELHORIA.md`. |

## Resposta à pergunta 3 do pacote (extrair lógica de escopo agora?)

Seguida a recomendação dividida do Qwen: `isAdmin()` extraída **agora**
(ressalva 2, acima). A checagem de "empresa operável"
(`company.isActive`) **não** foi extraída ainda — os dois call sites
(`JobsService.assertCompanyActiveOrThrow` → `company_not_found`;
`CandidateProfileService.getByUserId` → `candidate_profile_not_found`)
lançam `reason`s diferentes de propósito, e unificar cegamente
reintroduziria um canal de enumeração. Registrado para extrair só o
**predicado** (`isCompanyOperable(companyId): Promise<boolean>`) quando
`Application` existir — cada módulo continua decidindo qual 404 lançar.

## Verificação

Build limpo · lint 0 avisos · `npm test` 4/4 · `npm run test:e2e`
**75/75 (79 no total)**, rodado 5× seguidas sem falha (3 antes da
verificação da ressalva 3, mais 2 depois) · N1 reproduzido manualmente
contra o servidor de dev (CEP inválido → `400 cep_nao_encontrado`; CEP
válido → `201` com endereço) · ressalva 3 verificada apagando
`src/generated/prisma/` e confirmando que `db:reset:test` se autocura
com o `prisma generate` adicionado.
