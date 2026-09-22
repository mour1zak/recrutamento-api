# Parecer — Qwen (QA Lead & DevSecOps) — Fase 3: Domínio (Companies + Jobs), Rodada 9

> Registro do retorno recebido em resposta à reapresentação da Rodada 8.
> Condensado mas fiel ao original (relatório completo anexado pelo
> usuário, `RELATORIO-QWEN-FASE3-DOMINIO-RODADA9.md`). Triagem em
> `TRIAGEM-REVISOES-RODADA9.md`.

**Veredito: APROVADO COM RESSALVAS.** Os três críticos da Rodada 8 estão
fechados — reatacados com carga maior e combinações novas. Isolamento
entre empresas resistiu à matriz completa papel×empresa; a corrida de
status não sobrescreveu estado terminal em nenhuma de 96 execuções
concorrentes; empresa desativada bloqueia as três escritas. Nenhuma
falha crítica nesta rodada.

## Confirmações por execução

- **C1 fechado:** matriz papel×empresa refeita com vaga nova e empresa
  distinta por caso — ADMIN mantém acesso global (`companyId` null ou
  não), RECRUITER com `companyId: null` (o cenário exato da rodada 8)
  agora recebe `404` em tudo, `GET /jobs/mine` devolve lista vazia.
- **C2 fechado:** 60 rodadas de `CANCELED ‖ PAUSED` a partir de `OPEN` +
  6 rodadas com 8 requisições simultâneas (108 requisições em corrida no
  total) — 0 estados terminais sobrescritos, 0 `5xx`.
- **C3 fechado:** recrutador de empresa desativada bloqueado em
  criar/editar/publicar (`404` nos três).

## Dois achados novos (nenhum bloqueante)

**N1 (ressalva com gate, Nível B):** `hasJobScope()` decide acesso
global por `user.roleName === 'ADMIN'` — uma string sem proteção no
banco. Provado (simulando o que o Nível B produziria): renomear o papel
ADMIN e criar um novo papel chamado "ADMIN" com `companyId` de outra
empresa dá acesso cruzado a esse impostor, enquanto o ADMIN real (papel
renomeado) perde acesso. **Não alcançável pela API hoje** (exige
`role:manage`, ainda não implementado, ou acesso direto ao banco) — vira
gate do Nível B, não veto.

**N2 (ressalva obrigatória):** o teste que prova o C2 tem uma asserção
falsa como invariante (`exatamente uma responde 200`) — existe um
entrelaçamento legítimo (`PAUSED` commita primeiro, `CANCELED` lê
`PAUSED` depois e aplica `PAUSED→CANCELED`, transição válida) que produz
`[200,200]` com resultado correto. Taxa medida: 5% das execuções. A
asserção certa: nenhum `5xx`; final sempre um dos dois pedidos; se
`CANCELED` respondeu `200`, o final tem que ser `CANCELED`.

## Ressalvas menores

**Q3/N8** — checar `isActive` só nas escritas é aceito (não cascatear é
a decisão certa), mas a vitrine pública anunciava vaga de empresa que
`GET /companies/:id` já dizia não existir — corrigir com
`company.isActive` nas leituras públicas (`findPublicList` e o ramo
"OPEN é público" de `findOne`), sem tocar no status de nenhuma vaga.
**N3** — mensagem do `409 vacancies_below_filled_count` perdeu os
números concretos; `count === 0` cobria duas causas diferentes sob o
mesmo `reason`. **N4** — mensagem do `409 status_changed_concurrently`
diz "tente novamente", mas um retry ingênuo do mesmo payload pode bater
num `400` de transição inválida; orientar reler o recurso antes. **N6**
— a suíte assume banco recém-semeado (asserção absoluta sobre número de
admins ativos quebra se outro processo criar dados no mesmo banco);
documentar isso no README, não é bug de produto. **N5** — guarda
otimista por valor, não por versão (ABA), risco baixo aqui.

## O que está bom

Contrato de erro limpo e unificado, nenhum vazamento de estrutura
interna em 3 rodadas de auditoria. `hasJobScope()` como ponto único de
decisão é "a correção estrutural certa" — resolveu 4 vetores de ataque
com uma função, não com ifs espalhados. `updateMany` condicional é "o
mesmo primitivo já provado no `refresh()` da Fase 2" aplicado
corretamente a um caso novo. `db:reset:test` restaurou o banco depois
dos ataques de auditoria sem intervenção manual.

## Condições

1. N2 corrigido (asserção do teste de concorrência).
2. N6 e Q3/N8 com decisão registrada (ou corrigida).
3. N1 adicionado ao gate do Nível B.
4. Itens 5–9 (decisão sobre candidatura em vaga de empresa desativada,
   N4, R5 parcial, N9/N15 herdados, `CHECK` de `filledCount`) antes de
   `Application`.
