# Parecer — Qwen (QA Lead & DevSecOps) — Fase 3: Domínio (Companies + Jobs), Rodada 8

> Registro do retorno recebido em resposta ao
> `PACOTE-QWEN-FASE3-DOMINIO-COMPANIES-JOBS.md`. Condensado mas fiel ao
> original (relatório completo anexado pelo usuário,
> `RELATORIO-QWEN-FASE3-DOMINIO-RODADA8.md`). Triagem em
> `TRIAGEM-REVISOES-RODADA8.md`.

**Veredito: REPROVADO.** Os três ataques pedidos (isolamento entre
empresas, corrida check-then-write, vazamento de `reason`) produziram
três achados críticos — todos reproduzidos por execução real contra
PostgreSQL 15.19.

## C1 — `companyId: null` era "acesso global", e o seed entregava um RECRUITER assim

`isInScope()`/`resolveCompanyIdForCreate()` tratavam `companyId === null`
como "sem restrição" (achando que só ADMIN chegava nesse estado);
`findMine()` já tratava corretamente (sem empresa + não-ADMIN = fora de
escopo). O RECRUITER do seed nascia sem `companyId`, com a senha pública
documentada. Com essa única credencial, sem manipular banco: editou
(`200`), leu (`200`) e cancelou (`200`) vaga de outra empresa, e **criou
e publicou uma vaga em nome de empresa alheia**, que apareceu na vitrine
pública. É a regra obrigatória do enunciado ("recruiter só opera vagas da
própria empresa") quebrada de ponta a ponta — e o próprio teste de
isolamento do time não pegou porque fabricava recrutadores via Prisma
**com** `companyId` já definido, nunca exercitando o usuário real do seed.

## C2 — corrida check-then-write quebra a máquina de estados hoje

`updateStatus()` lia o status, validava em memória, e escrevia em passo
separado — sem transação, sem `updateMany` condicional. Em 25 rodadas de
duas `PATCH .../status` simultâneas na mesma vaga (`CANCELED` vs.
`PAUSED`, partindo de `OPEN`), **13 terminaram com `PAUSED` sobrescrevendo
um `CANCELED` já commitado** — um estado que a própria tabela de
transições declara terminal. Sequencialmente a mesma transição já
recusava corretamente (`400`). Mesmo padrão do C4 (Fase 2, refresh token)
e do N1 (Fase 2, último admin) — os dois já corrigidos neste projeto, os
dois encontrados por execução adversarial, não por revisão de código.

## C3 — empresa desativada não impede seus recrutadores de continuar operando

Só o ramo ADMIN de `resolveCompanyIdForCreate()` checava
`company.isActive`; `findScopedOrThrow()` (usado por `update`/
`updateStatus`) não checava em nenhum ramo. Resultado: um recrutador de
empresa desativada criou vaga (`201`), editou (`200`) e publicou
`DRAFT→OPEN` (`200`) — a vaga apareceu na vitrine pública — enquanto
`GET /companies/:id` da mesma empresa já respondia `404`. O soft-delete
de empresa (achado C5, rodada 1/3) não desativava nada na prática.

## Ataque 3 (vazamento de `reason`): limpo

14 corpos de erro coletados, zero menção a nome de constraint, tabela,
coluna ou P-code — "este item está limpo". Três problemas de **contrato**
(não de vazamento) no mesmo formato: (1) dois formatos de `409`
convivendo (`error` presente ou ausente conforme a origem do erro); (2)
`403` sem `reason`; (3) `company_already_inactive`/`company_already_active`
devolvendo `404` quando o recurso existe (deveria ser `409` — e era o
único lugar em que o `reason` distinguia "não existe" de "existe e está
inativa", um canal de enumeração de baixa severidade).

## Ressalvas (não bloqueiam; corrigir antes da Fase 5)

R1 (sem `include`/`select` de `company` nas respostas de vaga — mesma
"lição nº 1" do projeto, agora no primeiro módulo de domínio); R2
(listagem pública sem JWT mas detalhe exige JWT — vitrine sem porta); R3
(`search` não escapa curingas de `LIKE`); R4 (`OPEN→CLOSED` sumiu da
máquina de estados, contradizendo o comentário do enum no schema); R5
(vitrine pública expõe `createdById`/`filledCount`); contrato de erro
(ver Ataque 3); `GET /companies/:id` sem escopo (aceito por ora, registrar
decisão). Reforçadas: N9 rate limiting (mais relevante agora que `GET
/jobs` é público com `search` não indexado), `CHECK` de `filledCount`
ainda ausente do DDL.

## O que está bom

Os dois achados da rodada 7 (banco errado no `db:reset:test`, mapeamento
de SQLSTATE) foram corrigidos e reverificados com ataque novo (banco
canário refeito). 49/49 testes verdes, lint e build limpos, `reason`
nunca vaza estrutura interna, política anti-enumeração (`404` em vez de
`403`/vazamento) implementada de verdade onde o escopo estava correto.

## Condições para reapresentação

C1 fechado com as duas funções corrigidas + seed com empresa + teste com
o usuário real do seed (idealmente trava no banco). C2 fechado com
escrita condicional atômica + teste e2e concorrente. C3 fechado com
decisão explícita (`isActive` checado em toda escrita de vaga) + teste
com recrutador de empresa desativada. Ressalvas 1, 4 e 6 com destino
definido no `CONDICOES-ENTRADA-FASE2.md`.

**Nota do Qwen:** os três críticos compartilham a mesma causa: "uma regra
escrita em comentário que o código não aplica em todos os caminhos" — já
a quarta vez que este padrão aparece no projeto.
