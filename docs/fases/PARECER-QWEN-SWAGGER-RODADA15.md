# Parecer — Qwen (QA Lead & DevSecOps) — Documentação Swagger, Rodada 15

> Registro do retorno recebido em resposta ao `PACOTE-QWEN-SWAGGER.md`.
> Condensado mas fiel ao original (`RELATORIO-QWEN-SWAGGER-RODADA15.md`).
> Triagem completa em `TRIAGEM-REVISOES-RODADA15.md`.

**Veredito: REPROVADO** — não pela decisão de exposição de `/docs` em si
(essa seria "discutível, recomendo mudar"), mas porque **o documento
publicado entregava uma credencial ADMIN funcional**, provado de ponta a
ponta contra o servidor real: `GET /docs-json` sem nenhuma credencial →
`LoginDto.email`/`password` traziam o email e a senha REAIS do ADMIN do
seed nos `example` → `POST /auth/login` com esses valores → `200`, token
de administrador. Um atacante anônimo lê um endpoint público, copia dois
valores de exemplo, e sai com o token mais privilegiado do sistema, sem
brute force e sem nunca ter visto o repositório.

**Ambiente:** PostgreSQL real, build de produção (`npm run build` +
`node dist/main.js`), `openapi.json` extraído e analisado
programaticamente (325 strings descritivas, 17 schemas, 41 operações,
175 respostas). Verificação declarada confirmada: `test:e2e` 142/142 ·
`test` 9/9 · `lint` 0/0 · `build` exit 0 · 0 respostas 500 documentadas ·
41/41 operações com `security` declarado.

## Parte 1 — C1 (a causa da reprovação): credencial real publicada

`LoginDto.email` = `admin@recrutamento.test` (email real do seed) e
`LoginDto.password` = `Senha@123` (o fallback real de
`SEED_USER_PASSWORD`) — as duas metades de uma credencial viva, no mesmo
schema, servidas sem autenticação. Contraste: `RegisterDto.password` usa
`"SenhaForte@123"`, inofensivo porque não existe conta com essa senha —
o problema nunca foi ter `example`, foi ter escolhido, no `LoginDto`, um
par que **funciona**. Muda uma posição da própria Rodada 5 (N16, "senha
de teste pública" — aceita porque vivia só no repositório/banco
descartável; servi-la por um endpoint em execução é outra classe de
exposição, machine-readable, e a UI pré-preenche o formulário com ela).
Correção: remover os valores reais, independente da decisão sobre
`/docs`.

## Parte 2 — Pergunta 1 (`/docs` deveria exigir `x-api-key`?): **Sim**

A premissa técnica estava certa (guards do Nest não interceptam o
middleware Express do `SwaggerModule.setup()`), mas a conclusão não
seguia dela. Quatro razões: (1) o argumento "Stripe/GitHub documentam
publicamente" não se aplica — esta API decidiu três vezes (CE-1) que o
consumidor é sempre um cliente conhecido, nunca navegador anônimo; (2) o
próprio `info.description` diz "obrigatória em toda rota, sem exceção" e
o documento é servido pela rota que é a exceção — autocontradição; (3) o
que vaza é o inventário completo pra reconhecimento (34 paths/41
operações, 17 schemas com limites e regex, 24 permission keys por rota,
15 `reason` codes, todos os enums); (4) custo de proteger é ~zero pra
quem já usa a API. Recomendação de caminho técnico: middleware Express
antes do `SwaggerModule.setup()`, comparação em tempo constante, mesmo
`401`+`WWW-Authenticate` do `ApiKeyGuard` — não JWT (documentação não é
ação de usuário autenticado).

## Parte 3 — Pergunta 3 (`/docs-json`): mesmo tratamento, é o que mais importa

É o artefato machine-readable (o que um script consome, não só a UI);
montado pela mesma chamada `SwaggerModule.setup()`; `/docs/` com barra
também responde 200, então a proteção precisa cobrir o prefixo inteiro.

## Parte 4 — Pergunta 2 (descrições revelam implementação demais?)

Varredura de 325 strings + todos os `example`: zero nomes de tabela,
constraint, algoritmo de hash, código Prisma ou SQLSTATE. **Um
vazamento genuíno**: a descrição de `PUT /roles/:id/permissions`
mencionava "transação `Serializable`" — detalhe de mecanismo de
concorrência útil pra quem for tentar uma corrida contra a rota (o
projeto já teve 3 dessas: C4, K2, K3). Recomendação: remover a palavra,
manter "atomicamente". Os 15 `reason` codes e as 24 permission keys por
rota NÃO são vazamento — são o contrato, publicá-los é correto.

## Parte 5 — Pergunta 4 (campo sensível no schema dos DTOs?): Não

Os 17 schemas são todos de REQUISIÇÃO — não existe nenhum schema de
resposta no documento (isso vira a Ressalva 1, abaixo). `password`/
`tokenHash`/`Document.path` nunca aparecem (coerente com o `omit` global
do Prisma). O defeito da Parte 1 é de VALOR de exemplo, não de forma do
schema.

## Ressalvas (Parte 6)

1. **0 de 175 respostas tinham `schema`** — o documento não dizia a
   nenhum cliente o que volta: nem o envelope de paginação, nem —
   principalmente — a distinção completo × reduzido de
   `CandidateProfile`/`Application`/`Document`, que é o coração das
   regras de visibilidade que custaram as rodadas 10-13. "41 endpoints
   documentados" era verdade pra paths/verbos/códigos; o contrato de
   RESPOSTA, ausente.
2. `info.description` se autocontradiz (Parte 2, item 2).
3. README dizia "9 tags"; medido: **10**.
4. Sem `cache-control` em `/docs`/`/docs-json`.
5. O pacote descrevia o escopo como "só decorators", mas o diff incluía
   `prisma.service.ts` com limites de pool novos — mudança de service,
   bem-vinda (fecha N15 da rodada 5), mas a descrição do escopo não foi
   exata.
6. Nada regrediu do que já fora verificado — `ApiKeyGuard` continua
   efetivo, build/lint limpos, suíte 142/142.

## O que está bom (Parte 7)

Nenhum 5xx documentado em 175 respostas · 41/41 operações com
`security` · UI 100% self-hosted (0 CDN externo) · headers de segurança
do helmet ativos em `/docs`/`/docs-json` · gzip ativo · zero nome de
estrutura de banco em 16.760 caracteres de descrição · o bloqueante da
Rodada 14 corrigido exatamente como prescrito, virando regra escrita do
projeto · N15 (pool do `pg`) fechado.

## Condições (Parte 8)

**Bloqueante:** remover a credencial real dos `example` de `LoginDto`.
**Decisão pedida (recomendação: mudar):** `/docs`+`/docs-json` atrás de
`x-api-key`, com teste e2e dos três caminhos.
**Antes de fechar o bônus:** remover "Serializable" da descrição de
`PUT /roles/:id/permissions`; schemas de resposta pelo menos no envelope
de paginação e nos payloads completo × reduzido de
`GET /candidates/:userId`, `GET /applications/:id` (e `GET /jobs/:id`,
citado no relatório original).
**Desejável:** ressalvas 2, 3 e 5 (texto, contagem de tags, descrição de
escopo do commit).
