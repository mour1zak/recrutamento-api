# Triagem das revisões — Qwen rodada 9 (Fase 3, Domínio: Companies + Jobs)

Resposta do time a `PARECER-QWEN-FASE3-DOMINIO-RODADA9.md`. Mesma
legenda: ✅ aceito e corrigido · 📋 aceito, planejado pra fase futura ·
⏸️ registrado, sem ação agora · ⚖️ discordamos.

## Confirmações — nenhuma ação necessária

C1, C2, C3 (Rodada 8) confirmados fechados sob carga maior e combinações
novas — sem mudança de código, só celebração de que a correção estrutural
(`hasJobScope()`, `updateMany` condicional, `assertCompanyActiveOrThrow`)
se sustentou.

## Obrigatórias — corrigidas nesta rodada

| ID | Item | Veredito | Correção |
|---|---|---|---|
| N2 | Asserção do teste de concorrência é falsa como invariante (~5% flaky) | ✅ | Reescrita para o invariante real: nenhum `5xx`; estado final sempre um dos dois pedidos; **se `CANCELED` respondeu `200`, o final tem que ser `CANCELED`** (terminal nunca desfeito). Rodado 10× por execução do teste (sugestão do Qwen — uma corrida só não pega regressão com confiança); confirmado 8 execuções seguidas sem falha (80 corridas no total) antes de comitar. |
| Q3/N8 | Vitrine pública anunciava vaga de empresa que `GET /companies/:id` já dizia não existir | ✅ | `findPublicList()` ganhou `company: {isActive: true}` no `where`; `findOne()` só trata a vaga como publicamente visível se `status === OPEN` **e** `company.isActive` — fora disso, cai no caminho de dono (`job:read:any` + mesma empresa), que continua funcionando independente do estado da empresa (não cascateia o status da vaga, só a visibilidade pública). Testado: vaga `OPEN` de empresa recém-desativada some da vitrine e do detalhe público (`404` pra quem não é dono), mas o dono continua lendo (`200`). |
| N6 | Suíte assume banco recém-semeado, sem estar documentado | ✅ | README §4.7 ganhou um parágrafo explícito: se a suíte falhar com "número errado" em vez de "comportamento errado", é banco sujo — rodar `npm run db:reset:test` antes. |

## Gate do Nível B — registrado

| ID | Item | Veredito | Detalhe |
|---|---|---|---|
| N1 | `hasJobScope()` decide acesso global por `roleName === 'ADMIN'` (string sem proteção no banco) | 📋 | Não alcançável pela API hoje (exige Nível B ou acesso direto ao banco) — adicionado ao Gate Nível B em `CONDICOES-ENTRADA-FASE2.md`, junto com a recomendação do Qwen de trocar por uma permission key (`job:write:any` ou equivalente) em vez de nome de papel, quando o Nível B for implementado. |

## Antes de `Application` — registrado

| ID | Item | Veredito | Detalhe |
|---|---|---|---|
| N4 | Mensagem do `409` de concorrência convida a um retry que bate em `400` | ✅ | Corrigida agora, já que estava tocando no mesmo método: orienta reler o recurso (`GET`) antes de tentar de novo, em vez de só "tente novamente". |
| N3 | Mensagem do `409 vacancies_below_filled_count` sem números; `count === 0` cobria 2 causas | ✅ | Corrigida agora: re-consulta o estado atual pra distinguir "vaga saiu de escopo" (→ `404`) de "invariante violada de verdade" (→ `409` com os números concretos). |
| — | Candidatura em vaga de empresa desativada: aceita ou não? | 📋 | Registrado como decisão a tomar explicitamente ao construir `Application` — não implementável ainda (módulo não existe). Recomendação preliminar: não aceitar, mesma lógica de "escrita bloqueada em empresa inativa" já aplicada em Jobs. |
| — | R5 parcial — `GET /jobs/:id` (vaga OPEN) ainda expõe `createdById`/`filledCount` pra quem não tem `job:read:any` | 📋 | Registrado — mesmo `select` da vitrine pública deveria valer pro detalhe público; não corrigido nesta rodada por não ter sido classificado como obrigatório pelo Qwen. |
| — | N9 (rate limiting), N15 (pool do `pg`) | 📋 | Sem mudança — reforçados pelo Qwen (agora `GET /jobs` público faz `LIKE` + `count` + join de company por página). |
| — | `CHECK (filledCount <= vacancies)` ausente do DDL | 📋 | Segue no Gate Fase 3 — a guarda atômica de `update()` cobre o caminho via API, o `CHECK` cobre SQL direto. |

## Menores — registrado, sem ação agora

N5 (guarda otimista por valor, não por versão — ABA, risco baixo aqui);
itens herdados já rastreados (`RECRUITER ⇒ companyId NOT NULL`, N10
`/health`, NFC no `preHash`, `crypto.scrypt`, `familyId`, CI mínimo,
normalização de email no banco).

## Verificação

Build limpo · lint 0 avisos · `npm test` 4/4 · `npm run test:e2e`
**56/56 (60 no total)** · teste de concorrência (N2) rodado 8× seguidas
sem falha antes de comitar · confirmado manualmente contra o servidor de
dev (vaga OPEN de empresa desativada some da vitrine e do detalhe
público, dono continua lendo).
