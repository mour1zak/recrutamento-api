# Parecer — Qwen (QA Lead & DevSecOps) — Fase 2: Auth, Rodada 7

> Registro do retorno recebido em resposta ao `PACOTE-QWEN-FASE2-AUTH.md`
> (rodada 7). Condensado mas fiel ao original (relatório completo anexado
> pelo usuário, `RELATORIO-QWEN-FASE2-AUTH-RODADA7.md`). Triagem em
> `TRIAGEM-REVISOES-RODADA7.md`.

**Veredito: APROVADO COM RESSALVAS.** N1-a e N5-a (rodada 6) fecharam de
vez, sob carga adversarial ainda maior que a testada antes. Nenhuma
falha crítica **em produto** nesta rodada — mas um achado crítico novo
**na ferramenta de desenvolvimento**, e uma lacuna real no filtro de
exceções que só vai morder na Fase 3.

## N1-a e N5-a — fechados, com margem maior

- **N1-a:** 5 formatos de ataque diferentes contra a trava de último
  admin (20 pares simultâneos; estado mínimo de 2 admins repetido 10×;
  ciclo de 4 admins; carga máxima de 8 atores/8 alvos; `deactivate` +
  `reactivate` simultâneos no mesmo alvo) — **zero `5xx` em todos**, e o
  invariante ("≥1 admin ativo") nunca foi violado. Confirmado que os
  `409` vêm do duck-typing de `TransactionWriteConflict`, não de outra
  regra. Suíte e2e rodada 2× seguidas sem reset: 14/14 nas duas — a
  reentrância também se confirmou.
- **N5-a:** `env -u DATABASE_URL npx prisma generate` funciona; e mais —
  `env -u DATABASE_URL npm run test:e2e` numa árvore sem
  `src/generated/` também funciona (14/14), e `npm run build` passa com
  `DATABASE_URL` dummy.

## Achado crítico novo — `db:reset:test` podia apagar o banco errado

`dotenv run`, por padrão, não sobrescreve variáveis já existentes no
ambiente. Provado com um "banco canário": `DATABASE_URL` exportada no
shell apontando pra outro banco → o script derrubava **esse** banco, não
o `recrutamento_test`. Agravante: o próprio README §4.7 ensina a exportar
`DATABASE_URL` manualmente antes de outros comandos — quem seguisse essa
instrução e depois rodasse `db:reset:test` podia perder o banco de
desenvolvimento, sem aviso e sem confirmação adicional além do `--force`.
Não reprovou a rodada por isso (é ferramenta, não comportamento da API),
mas registrou como "correção imediata, antes que outra pessoa rode o
script".

## Lacuna real no filtro — vai morder na Fase 3

Pergunta respondida por execução real: **sim, restam erros do driver
adapter não reconhecidos**, e um deles é exatamente o que o Gate Fase 3
promete produzir. Qwen criou de verdade o
`CHECK (filledCount <= vacancies AND filledCount >= 0)` e o violou dos
dois jeitos possíveis:

| Situação | Código Prisma | SQLSTATE | HTTP antes do fix |
|---|---|---|---|
| `CHECK` violado via SQL cru (`$executeRawUnsafe`) | `P2010` | `23514` | `500` |
| `CHECK` violado via client (`prisma.job.update`) | `P2039` | `23514` | `500` |
| `unique` violado via SQL cru | `P2010` | `23505` | `500` |
| `Int` estourado (ex.: `sizeBytes=5e9`) | `P2020` | — | `500` (deveria ser `400`) |

Raciocínio: o `CHECK` da Fase 3 só existe para disparar sob concorrência
real — e quando disparar, o cliente recebe `500` em vez de `409`,
fazendo parecer que a trava falhou quando na verdade ela funcionou (só a
tradução do erro que estava errada). Sinalizado também como risco não
medido: os SQLSTATEs retryáveis de uma fila de `FOR UPDATE` (`40P01`
deadlock, `55P03` lock indisponível, `57014` timeout de statement)
provavelmente caem no mesmo buraco.

## Ressalvas

**Antes da Fase 3 (obrigatórias, baratas):** mapear a classe 23 do
SQLSTATE (`23505`/`23514`→409, `23503`/`23502`→400) mais `P2039`/`P2020`
no switch; cobrir os SQLSTATEs retryáveis; N9 (rate limiting) e N15 (pool
do `pg`), sem mudança desde a rodada 5.

**Menores (antes da Fase 5):** dois formatos diferentes de corpo `500`
(um com campo `error`, outro sem); README §2.1 não atualizado com a rota
`reactivate`; método não suportado devolve `404` em vez de `405` (não é
defeito, só nota de contrato); `reactivate` sem trava é correto mas
merece uma linha de comentário explicando o porquê (assimetria com
`deactivate`); `engines: node>=22` gera `EBADENGINE` ao rodar em Node 20
(lembrete pro CI, não defeito).

## O que está bom

A trava de último admin é "a primeira garantia de concorrência deste
projeto que sobrevive a tudo que foi jogado nela" — quatro tentativas
anteriores (rodadas 1, 4 e 6) tinham cedido. O comentário de
`deactivate()` foi chamado de "o melhor documento técnico do repo". O
filtro unificado não regrediu nenhum formato de erro do Nest
(ValidationPipe, `HttpException` de Service, 404 de rota). `reactivate`
tem uma propriedade de segurança correta que nem foi reivindicada: não
ressuscita sessões revogadas. `lint`/`build`/`test`/`test:e2e` passam
juntos sem nenhuma intervenção externa pela primeira vez.

## Condições

**Imediato:** corrigir `db:reset:test` (não sobrescrever `DATABASE_URL`
existente). **Antes de abrir a Fase 3:** mapeamento de SQLSTATE
(incluindo `P2039`/`P2020` e os retryáveis), N9, N15 — mais um item novo
no Gate Fase 3: "o `CHECK` disparando produz `409`, não `500`, com
teste". **Antes da Fase 5:** ressalvas menores.
