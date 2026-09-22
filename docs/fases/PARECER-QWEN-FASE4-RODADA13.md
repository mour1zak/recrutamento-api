# Parecer — Qwen (QA Lead & DevSecOps) — Fase 4, Rodada 13 (reapresentação)

> Registro do retorno recebido em resposta à reapresentação da Rodada 12
> (6 críticos). Condensado mas fiel ao original
> (`RELATORIO-QWEN-FASE4-RODADA13.md`). Triagem completa em
> `TRIAGEM-REVISOES-RODADA13.md`.

**Veredito: APROVADO COM RESSALVAS.** Os seis críticos foram reatacados
com carga maior do que a que os encontrou, e as taxas foram a zero:

| Achado | Rodada 12 | Rodada 13 |
|---|---|---|
| K1 `filledCount > vacancies` | 15/25 (60%) | 0/45 rodadas |
| K2 zero papéis com `role:manage` | 10/12 (83%) | 0/20 rodadas |
| K3 zero admins ativos | 10/12 (83%) | 0/20 rodadas |
| K4 `{}` → 500 | 100% | `400` estruturado |
| K5 empresa desativada com acesso | 4 rotas em 200 | 9/9 rotas em 404 |
| K6 documentos não anexados liberados | 100% | `404` (só o anexo libera) |

Testado inclusive além do pedido: K1 com `vacancies` mudando **duas
vezes** em voo (0/20 violações), K2/K3 com o dobro de rodadas, `CHECK`
confirmada disparando e virando `409` (não `500`), Serializable
verificado sem custo em caminhos quentes sem conflito real.

## Ressalvas — todas de contrato/documentação, nenhuma de segurança

1. O `409` de conflito de serialização não tinha `reason` — era o
   desfecho **mais frequente** das duas travas novas.
2. `Serializable` produz um `409` legítimo (não indevido, mas não
   documentado) em `PUT /roles/:id/permissions` mesmo entre papéis
   diferentes que não tocam `role:manage`, por leitura de predicado
   global compartilhada.
3. **Drift de especificação:** o mapa do DeepSeek §6 ainda descrevia a
   regra de escopo de `Document` que o K6 reprovou (`resumeDocumentId`
   OU `ownerId`) — a implementação corrigida diverge do documento de
   referência sem nota.
4. Efeito colateral do K6: só `RESUME` pode ser anexado hoje
   (`Application` tem um slot só), então `COVER_LETTER`/`CERTIFICATE`/
   `OTHER` nunca ficam visíveis a recrutador nenhum — não é bug da
   correção, é uma lacuna de modelo que ela tornou visível.
5. `REJECTED` remove acesso ao currículo já anexado — coerente com a
   minimização de dados do projeto, mas decisão implícita que merece
   registro explícito.
6. `fileParallelism: false` foi a decisão certa, mas reduz a chance da
   própria suíte pegar futura interferência cruzada entre arquivos — a
   solução estrutural (banco por arquivo) fica fora do escopo desta
   avaliação.
7. As 11 ressalvas adiadas da rodada 12 seguem sem crítica nova; duas
   priorizadas por interagirem com o que foi corrigido agora
   (`updateCompany` sem checar `isActive`; ciclo de vida do arquivo
   órfão, agora que `GET /documents/:id` é a única rota que serve
   arquivo).

## Condições pra fechar a Fase 4

1. `reason` no 409 de conflito de serialização.
2. Atualizar o mapa do DeepSeek §6 (e README §5) pra regra real de
   `Document`.
3. Documentar o 409 de concorrência benigno em `PUT /roles/:id/permissions`.

Itens 4-7 ficam "antes da Fase 5", não bloqueantes.
