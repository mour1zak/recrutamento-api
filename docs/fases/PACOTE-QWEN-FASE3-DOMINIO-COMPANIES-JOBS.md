# Pacote para revisão — Qwen (QA Lead & DevSecOps) — Fase 3: Domínio, Rodada 9 (reapresentação)

Cole este documento inteiro na conversa com o Qwen.

---

Você é o **QA Lead / DevSecOps Specialist** do projeto `recrutamento-api`.
Na Rodada 8, você **reprovou** Companies + Jobs com 3 críticos: (C1)
isolamento entre empresas quebrado para qualquer usuário com
`companyId: null` — incluindo o RECRUITER do seed, com senha pública;
(C2) corrida check-then-write sobrescrevendo estado terminal da vaga em
52% de 25 corridas; (C3) empresa desativada não impedindo seus
recrutadores de continuar operando vagas. Relatório completo em
`PARECER-QWEN-FASE3-DOMINIO-RODADA8.md`; nossa resposta em
`TRIAGEM-REVISOES-RODADA8.md`. Esta é a reapresentação.

## O que foi corrigido

| Achado | Correção | Como validamos |
|---|---|---|
| **C1** (crítico) — `companyId: null` = acesso global; seed sem empresa | Função única `hasJobScope()` (substitui as 3 respostas divergentes do mesmo arquivo); `resolveCompanyIdForCreate()` ganhou a checagem que faltava; `prisma/seed.ts` cria "Empresa Seed" e vincula o RECRUITER a ela | **Testado com o usuário real do seed** (não fabricado): `PATCH`/`PATCH .../status`/`GET`/`POST {companyId: <alheia>}` em vaga/empresa de outra empresa → `404` nos quatro. Reproduzido também manualmente contra o servidor de dev, replicando o ataque exato do seu relatório |
| **C2** (crítico) — corrida sobrescrevia estado terminal | `updateStatus()` reescrito com `updateMany({where: {id, status: <lido>}})` — mesmo primitivo do `refresh()` da Fase 2; `count === 0` → `409`. Mesma correção aplicada preventivamente em `update()` | `Promise.all` de duas transições simultâneas (`CANCELED`/`PAUSED` a partir de `OPEN`): exatamente uma responde `200`, banco reflete só a vencedora, nunca as duas aplicadas |
| **C3** (crítico) — empresa desativada não bloqueava seus recrutadores | `isActive` da empresa agora checado em toda escrita de vaga (`create`/`update`/`updateStatus`); leitura de vaga já `OPEN` não é afetada retroativamente (decisão explícita) | Recrutador de empresa recém-desativada → `404` em criar/publicar vaga; vaga já `OPEN` da mesma empresa continua na vitrine (comportamento esperado, testado) |
| Ataque 3 (contrato de erro) | `error` unificado em todo corpo (`errorBody()`); `403` ganhou `reason: "permission_denied"`; `company_already_inactive`/`company_already_active` migraram de `404` para `409` | Testado nos três casos |
| R1/R5 — sem `include` de `company`; vitrine expondo `createdById`/`filledCount` | `GET /jobs*` inclui `company: {id, name}`; `select` dedicado só na listagem pública, sem os dois campos | Testado |
| R3 — `search` sem escapar `LIKE` | `escapeLikeWildcards()` | Revisão de código |
| R4 — `OPEN→CLOSED` sumida, contradizendo o schema | Reincluída em `VALID_TRANSITIONS` | Revisão de código |

## Adiado conscientemente (registrado, sem mudança de destino)

R2 (listagem pública sem JWT vs. detalhe exigindo JWT — decisão de UX,
não de segurança); `RECRUITER ⇒ companyId NOT NULL` como trigger de
banco (`FEEDBACKS-MELHORIA.md` #16 — Postgres não suporta `CHECK` com
subquery entre tabelas, exige função `plpgsql`, custo maior que os
demais itens desta rodada); N9 (rate limiting) e `CHECK` de `filledCount`
— seguem pré-requisito do Gate Fase 3.

## Verificação

`npm run build` limpo · `npm run lint` 0 avisos · `npm test` 4/4 ·
`npm run test:e2e` 55/55 (**59 testes no total**, 10 novos cobrindo
C1/C2/C3/R1/R5) · confirmado manualmente contra o servidor de dev
reproduzindo os ataques C1 e C3 do seu relatório.

## O que eu preciso de volta

Mesmo formato de sempre. Peço em particular: (1) confirmar que
`hasJobScope()` fecha o C1 em qualquer combinação de papel/empresa que
não testamos; (2) atacar a transição de status de novo, com carga maior
se possível — quero saber se `409 status_changed_concurrently` se sustenta
sob mais do que duas requisições simultâneas na mesma vaga; (3) confirmar
que checar `isActive` só nas escritas (não nas leituras) é uma decisão
aceitável, ou se você recomendaria cascatear o estado das vagas no
`deactivate` de empresa.
