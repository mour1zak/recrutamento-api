# Pacote para revisão — Qwen (QA Lead & DevSecOps) — Fase 3: Domínio (Companies + Jobs)

Cole este documento inteiro na conversa com o Qwen.

---

Você é o **QA Lead / DevSecOps Specialist** do projeto `recrutamento-api`.
Na Rodada 7, você aprovou a Fase 2 (Auth/RBAC) de vez. Esta é a primeira
rodada de auditoria sobre código de **domínio de negócio** — os dois
primeiros módulos construídos sobre a base de Auth/RBAC já auditada:
**Companies** (empresas) e **Jobs** (vagas). Nenhum dos dois foi revisado
por você ainda; é a estreia deles.

## O que existe pra revisar

### Companies (5 rotas)
`POST /companies` · `GET /companies/:id` · `PATCH /companies/:id` ·
`PATCH /companies/:id/deactivate` · `PATCH /companies/:id/reactivate`.
Só ADMIN cria/edita/desativa (RECRUITER só lê). CNPJ único, verificado
pelo banco (não check-then-create). Integração externa de CEP real
(ViaCEP) — falha nunca bloqueia a criação, endereço fica `null`.
`deactivate`/`reactivate` respondem `200` com o recurso atualizado
(decisão pós-Fase-2: `Users.deactivate/reactivate` também migrou de
`204` sem corpo pra esse formato, por consistência).

### Jobs (6 rotas)
`POST /jobs` · `GET /jobs` (pública, só vagas `OPEN`) · `GET /jobs/mine`
· `GET /jobs/:id` · `PATCH /jobs/:id` · `PATCH /jobs/:id/status`.
Regra obrigatória do enunciado: **recruiter só opera vagas da própria
empresa** — tentar agir sobre vaga de outra empresa é `404`, nunca `403`
(nunca confirma que o recurso existe fora do escopo de quem pergunta).
Máquina de estados: `DRAFT→{OPEN,CANCELED}`,
`OPEN→{PAUSED,FILLED,CANCELED}`, `PAUSED→{OPEN,CANCELED}`,
`FILLED→CLOSED`; `CLOSED`/`CANCELED` terminais. `vacancies` nunca pode
ficar abaixo de `filledCount`; `FILLED` só é aceito se
`filledCount >= vacancies`. `DELETE /jobs/:id` não existe de propósito
(soft-delete via status `CANCELED`).

### Formato de erro novo, só nestes dois módulos
`404`/`409` de regra de negócio agora incluem um campo `reason`
machine-readable (ex.: `{statusCode: 409, reason: "cnpj_duplicado",
message: "..."}`). Lista completa de reasons: `company_not_found`,
`company_already_inactive`, `company_already_active`, `cnpj_duplicado`,
`job_not_found`, `vacancies_below_filled_count`,
`invalid_status_transition`, `job_not_fully_filled`. Rotas de
`Auth`/`Users` (já auditadas) continuam sem `reason`, de propósito.

## O que já testamos por execução (não é só leitura de código)

- CNPJ duplicado → `409` com `reason: "cnpj_duplicado"`, testado com
  requisição real repetida.
- CEP real (ViaCEP, sem mock): CEP válido enriquece endereço; CEP
  inexistente cria a empresa mesmo assim, endereço `null`. Timeout/erro
  de rede testado separadamente com `HttpService` mockado (único mock do
  projeto — é o único jeito de provocar timeout de forma determinística).
- Duas empresas + dois recrutadores distintos (criados via Prisma
  direto): recrutador da empresa A nunca lê, edita, ou muda status de
  vaga da empresa B — sempre `404`.
- Todas as transições inválidas testadas retornam `400`; `FILLED` sem
  `filledCount` completo retorna `409`; reduzir `vacancies` abaixo de
  `filledCount` retorna `409`.
- Suíte completa: **49 testes automatizados** (45 e2e + 4 unitários),
  todos verdes, rodados depois de cada mudança.

## Observação de transparência (achado nosso, não seu — sinalizando pra você atacar)

`JobsService.update()` e `JobsService.updateStatus()` fazem
**leitura-então-escrita em dois passos separados** (`findUnique` seguido
de `update()`, sem transação nem `updateMany` condicional) — o mesmo
padrão de corrida que o C4 da Fase 2 (rotação de refresh token) e o N1 da
Fase 2 (trava de último admin) já provaram ser perigoso neste projeto
quando duas requisições concorrentes competem pelo mesmo registro. Hoje
o único jeito de escrever em `filledCount` é diretamente no banco (não
existe endpoint ainda — isso é o fluxo de contratação, ainda não
implementado), então o cenário de corrida real ("duas mudanças de status
simultâneas na mesma vaga", ou "atualizar `vacancies` no exato instante
em que `filledCount` está sendo incrementado por outro fluxo") não é
alcançável via API hoje. Mas registramos porque: (1) é exatamente o tipo
de coisa que este projeto já errou antes e só descobriu por execução
adversarial sua, não por revisão de código nossa; (2) o Gate Fase 3
(`CONDICOES-ENTRADA-FASE2.md`) já promete lock/transação pro fluxo de
contratação — se vocês conseguirem produzir a corrida mesmo sem esse
endpoint (ex.: duas `PATCH /jobs/:id/status` simultâneas competindo pela
mesma vaga), é um achado real que queremos antes de construir
Application por cima disso.

## O que eu preciso de volta

Mesmo formato de sempre (veredito, críticos, ressalvas, sugestões,
condições). Peço em particular: (1) tentar quebrar o isolamento entre
empresas de algum jeito que não testamos; (2) atacar a corrida
check-then-write mencionada acima, mesmo que indiretamente (duas
`PATCH /jobs/:id/status` ou dois `PATCH /jobs/:id` simultâneos no mesmo
`id`); (3) verificar se o novo formato de erro (`reason`) vaza alguma
informação que não deveria (nome de constraint, estrutura interna).
