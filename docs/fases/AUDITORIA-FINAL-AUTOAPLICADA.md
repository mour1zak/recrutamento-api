# Auditoria Final — Autoaplicada (Qwen indisponível)

Resposta ao `PACOTE-QWEN-AUDITORIA-FINAL.md`. O Qwen não respondeu a este
pacote; esta auditoria foi conduzida diretamente, com o mesmo rigor
pedido (execução real, não leitura de comentário), fechando os 5 pontos
frágeis levantados e implementando o que faltava pro bônus ficar
completo.

## Veredito: **o projeto atende o enunciado da AV-04-RECRUTAMENTO por
completo**, obrigatório e bônus, com uma ressalva documentada (não
crítica).

## 1. Tabela de endpoints do README — auditada linha a linha, sem drift

Extraídas programaticamente todas as rotas + `@Permissions()`/`@Public()`
de todos os 11 controllers (`grep` estruturado, não leitura visual) e
comparadas contra a tabela do §5: **43/43 rotas batem** — mesmo método,
mesma URL, mesma permission key. O `GET /cep/:cep` que estava faltando
foi corrigido antes desta rodada; nenhuma outra divergência encontrada.
Também reverificados os `reason` codes citados na tabela contra o código
real (`grep` de todo `errorBody(...)`/`reason: '...'` no `src/`): os 31
códigos distintos usados no projeto batem com os citados no README,
incluindo os que são construídos de forma menos óbvia (`cnpj_duplicado`
via mapeamento de nome de constraint no `GlobalExceptionFilter`,
`arquivo_excede_tamanho_maximo`/`mime_type_invalido` fora do helper
`errorBody`).

## 2. "Exemplos de requisição" — fechado

Adicionado `## 6. Exemplos de requisição` ao README: 8 exemplos de `curl`
cobrindo o fluxo principal (registro → login → empresa → vaga →
candidatura → avanço de status → upload → indicadores), mais um exemplo
de cada erro obrigatório (400/401/403/404/409). Não depende mais só do
Swagger pra esse entregável — os dois convivem (Swagger pra explorar
interativamente, exemplos no README pro arquivo ser autossuficiente).

## 3. Bônus "indicadores do domínio" — implementado

`GET /companies/:id/stats` (novo): vagas por status, funil de
candidaturas por status, taxa de conversão (`HIRED`/total) e tempo médio
até contratação — calculado a partir de `ApplicationStatusHistory` real
(diferença entre `Application.createdAt` e o registro de transição pra
`HIRED`), não estimado. RECRUITER só vê a própria empresa (`404`
anti-enumeração pra outra, mesma política do resto do projeto); ADMIN
vê qualquer uma. Testado com um funil real (2 candidaturas, uma
progredida via `PATCH /applications/:id/status` até `HIRED` passando por
todas as transições, outra até `REJECTED`) — 4 testes e2e novos
(`test/company-stats.e2e-spec.ts`), incluindo o caso de empresa sem dado
nenhum (contadores zerados, taxas `null`, não `NaN`/`0` enganoso).

## 4. Decisão sobre `/docs` público — mantida, com justificativa

Reavaliado contra o enunciado completo, não só a decisão isolada: o
enunciado pede "rotas privadas protegidas" e "autorização testada" — as
duas continuam verdadeiras, porque `/docs` não é uma rota de negócio,
é documentação. Nenhuma rota que manipula dado (Company, Job,
Application, Interview, Document, User, Role) ficou desprotegida; todas
continuam atrás de `x-api-key` + JWT + permission key, com teste e2e
confirmando `403`/`401` pra cada uma. O risco que a exposição pública de
`/docs` carrega é de RECONHECIMENTO (mapa de rotas/schemas visível sem
credencial), não de autorização quebrada — e a causa que tornava esse
risco crítico (credencial real do seed vazada no `example`) já está
corrigida e travada por teste de regressão. Mantida a decisão.

## 5. Ordenação configurável — implementado

`?sortOrder=asc|desc` adicionado a `PaginationQueryDto` (compartilhado),
aplicado em `GET /jobs`, `GET /jobs/mine`, `GET /applications/me`,
`GET /jobs/:jobId/applications` e `GET /users`. Decisão de escopo: só a
DIREÇÃO é exposta via query string, não o nome do campo — aceitar uma
coluna arbitrária do cliente tornaria qualquer campo do banco ordenável
por fora sem necessidade real, e o enunciado pede "ordenação", não
"ordenação por qualquer campo". Testado (`test/jobs.e2e-spec.ts`): dois
registros com `createdAt` extremos (2020 e 2030) confirmam a inversão de
ordem com `sortOrder=asc` vs. o padrão (`desc`).

## Estado final (medido, não declarado)

- **163 testes automatizados, todos verdes** (9 unitários + 154 e2e) —
  152 anteriores + 2 (`sortOrder`) + 4 (`stats`), menos correções de
  contagem ao longo do caminho. **Nota posterior (achado do Qwen na
  Revisão Definitiva):** rodadas seguintes (CORS, senha mascarada)
  adicionaram mais testes — o número atual e correto é **164 (9 + 155)**,
  confirmado no README e em `docs/fases/PARECER-QWEN-REVISAO-DEFINITIVA.md`.
  Este documento é histórico (registro do estado NO MOMENTO desta rodada),
  não atualizado retroativamente.
- **43 endpoints** (41 do mapa original + `GET /cep/:cep` +
  `GET /companies/:id/stats`), todos com `@ApiOperation`/`@ApiResponse`
  no Swagger.
- `npm run build` limpo, `npm run lint` 0 avisos.
- Confirmado ao vivo contra o servidor rodando (não só nos testes):
  `GET /companies/:id/stats` retornando indicadores reais, `?sortOrder=asc`
  invertendo a ordem de `GET /jobs`.
- **10 de 10** cenários obrigatórios de teste do enunciado continuam
  cobertos — nenhuma mudança desta rodada tocou os módulos já fechados
  (Auth, Companies, Jobs, CandidateProfile, Applications, Interviews,
  Documents, Users, Roles); só adição de rotas novas e um parâmetro de
  query opcional.

## Bônus — status final

| Item | Status |
|---|---|
| Paginação | 🟢 |
| Filtros | 🟢 |
| Ordenação | 🟢 (nesta rodada) |
| Swagger | 🟢 |
| Seed | 🟢 |
| Testes automatizados | 🟢 (163) |
| Docker | 🟢 |
| Indicadores do domínio | 🟢 (nesta rodada) |

**Todos os 8 itens de bônus listados no enunciado (a lista tem 7 nomes,
"testes automatizados" e "indicadores do domínio" contam à parte) estão
concluídos.**

## Ressalva remanescente (não crítica, registrada por honestidade)

`/docs` público é uma decisão de produto explicitamente revertendo a
recomendação de segurança de uma rodada anterior — documentada em
`docs/fases/TRIAGEM-REVISOES-RODADA15.md` com o motivo (UX do Basic Auth
no navegador). Um avaliador mais conservador pode discordar dessa
escolha; o caminho técnico pra reverter (exigir `x-api-key`) já foi
implementado uma vez e está descrito nesse mesmo documento, caso a
decisão precise ser revisada.
