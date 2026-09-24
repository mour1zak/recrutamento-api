# Etapa 12: Revisão Definitiva do Qwen — os 9 achados e o fechamento

> Pacote-fonte pra colar no NotebookLM. Esta foi a última rodada de
> auditoria antes dos testes manuais do usuário e da avaliação real. Os
> dois achados mais importantes (F2 e F6) não são bugs de regra de
> negócio — são bugs sobre **confiar na própria instrumentação**: um
> sistema que mente sobre o que aconteceu, e um conjunto de ferramentas
> que não enxerga o próprio erro.

## Achado F2 — o log dizia uma coisa, o sistema fez outra

### O que aconteceu, em linguagem simples

O interceptor que registra cada requisição (`LoggingInterceptor`) e o
filtro que traduz erros em respostas HTTP (`GlobalExceptionFilter`) são
dois componentes separados, e só o segundo sabe o status **final** que
realmente foi enviado pro cliente. O interceptor, por tentar logar tanto
sucesso quanto erro, lia o status **antes** do filtro terminar de
traduzir o erro — e nesse momento o status ainda era o valor padrão que o
Nest reserva pra rota (por exemplo, `201` pra todo `POST`), não o que
seria enviado de verdade.

Resultado, comprovado ao vivo: um cadastro de empresa rejeitado por CNPJ
duplicado (que devolve corretamente `409` pro cliente) aparecia no log
como `"status":201` — como se tivesse dado certo. Um upload de arquivo
grande demais (`400`, rejeitado corretamente) aparecia como `"status":413`
(um código HTTP que nem existe nas respostas reais do projeto).

### Por que isso é mais grave que parece

Pensa num porteiro de prédio que anota num caderno "às 14h, fulano
entrou" — mas na verdade fulano foi barrado na portaria e nunca entrou.
Se um dia alguém precisar investigar "quem entrou nesse horário?", o
caderno vai mentir. Não importa que o porteiro tenha barrado fulano
corretamente — o registro do que aconteceu está errado, e um log errado é
pior que nenhum log, porque passa confiança falsa. Isso é exatamente o
tipo de coisa que auditoria de segurança (ou um Grafana ligado a esses
logs, que é o que este projeto tem) usa pra reconstruir "o que aconteceu
de verdade" — e estava reconstruindo errado.

### A correção

Regra simples: **só quem sabe o status final pode logar o status**. O
interceptor agora só loga quando tudo dá certo (ele nunca precisa
"adivinhar" nada nesse caso, porque o sucesso não passa por tradução). Pra
qualquer erro, ele só marca um timestamp (`HTTP_REQUEST_START`) dizendo
"a requisição chegou até aqui" — e é o filtro de exceções, o único lugar
que efetivamente decide o status de resposta, quem escreve a linha de
log, sempre com o valor certo.

Esse timestamp também resolve um segundo problema de graça: rejeições de
`x-api-key`/token/permissão acontecem **antes** do interceptor sequer
rodar, então não existe timestamp pra elas — e o filtro usa essa ausência
pra saber que deve logar como `WARN` (evento de segurança, sem duração
calculável), em vez de `LOG` (erro de negócio comum, com duração).

### Como validamos

Reproduzimos ao vivo o cenário exato que o Qwen reportou (CNPJ duplicado)
antes e depois da correção: antes, log dizia `201`; depois, log diz `409`
— igual ao que o cliente realmente recebeu. Escrevemos testes automáticos
novos que travam essa regra (`global-exception.filter.spec.ts`, 3 casos)
e reescrevemos os testes do interceptor pra confirmar que ele **não loga
nada** em erro (só o filtro loga). Suíte completa rodada depois: 12
testes unitários + 155 e2e, todos verdes.

## Achado F6 — 16 erros que nenhuma ferramenta do projeto conseguia ver

### O que aconteceu, em linguagem simples

O projeto roda `nest build` (compila só o código de produção),
`vitest`/`vitest e2e` (roda os testes, mas sem checar tipos de verdade) e
`oxlint` (procura padrões perigosos, mas sem resolver o grafo completo de
módulos). Nenhuma das três é, na verdade, um checador de tipos completo.
O Qwen rodou o compilador de TypeScript puro, no modo "só verificar, não
gerar nada" (`tsc --noEmit`), e achou 16 erros de tipo que estavam lá o
tempo todo, escondidos.

É como ter três inspetores de prédio — um que confere só a fiação, outro
só o encanamento, outro só a pintura — e nenhum deles é engenheiro
estrutural. O prédio pode ter uma rachadura na fundação que nenhum dos
três nunca foi contratado pra procurar.

### O que eram os 16 erros

- 14 deles eram a mesma causa repetida: `import { App } from
  'supertest/types'` sem a extensão `.js` no final. O projeto usa uma
  configuração de módulos (`nodenext`) que exige essa extensão explícita
  pra um `import type` de um subcaminho de pacote — sem ela, o TypeScript
  não consegue confirmar que o tipo existe (mesmo que em tempo de
  execução funcione, porque ali não tem execução nenhuma, só um tipo).
- 1 erro era um `.catch()` que misturava dois tipos possíveis de retorno
  de um jeito que o TypeScript não conseguia garantir — resolvido
  reescrevendo como `try/catch` explícito.
- 1 erro era um array de strings de teste (`['INTERVIEW', 'OFFERED',
  'HIRED']`) que o TypeScript generalizava como "lista de textos
  quaisquer", quando na verdade precisava ser "lista desses três valores
  exatos do enum do banco" — resolvido com `as const`, que trava o array
  no seu significado literal.

### Por que isso importa pra uma avaliação

Nenhum desses 16 erros quebrava o build nem os testes — é por isso que
passaram despercebidos até agora. Mas um avaliador (ou uma IA avaliadora)
pode rodar `tsc` diretamente, ou o VS Code simplesmente mostra erro
sublinhado em vermelho em 16 arquivos assim que o projeto é aberto. Um
projeto "com erros vermelhos por todo canto", mesmo que funcione, passa a
impressão errada.

### A correção definitiva (não só os 16 erros — o buraco na ferramentagem)

Além de corrigir os 16 pontos, adicionamos um script novo,
`npm run typecheck`, que roda exatamente o comando que o Qwen usou pra
achar o problema. Agora essa checagem existe como um comando de primeira
classe do projeto — não fica mais invisível pra quem seguir o fluxo
normal de desenvolvimento.

### Como validamos

`npx tsc --noEmit -p tsconfig.json` → zero erros. Suíte completa rodada
de novo depois de todas as mudanças (build, 12 unitários + 155 e2e,
lint) — nenhuma regressão.

## Os outros achados, em checklist

| # | Achado | O que era | Status |
|---|--------|-----------|--------|
| F1 | Números de testes/rotas desatualizados no README e na auditoria | Contagens antigas (163, 154, 158, 42) não batiam com a realidade atual (164 testes, 43 rotas) | ✅ Corrigido |
| F8 | Roteiro de apresentação sem instruções de porta pro demo com Grafana | Faltava a seção `4.9 Docker + Observabilidade` no README e avisos de porta (`:3001`/`:3002` vs `:3000`) nos guias | ✅ Corrigido |
| F2 | Log registrava o status ERRADO em erros traduzidos pelo filtro | Ver seção acima | ✅ Corrigido, testado e verificado ao vivo |
| F6 | 16 erros de tipo latentes, invisíveis a build/testes/lint | Ver seção acima | ✅ Corrigido; gate `typecheck` adicionado |
| F3 | Comentário desatualizado em `main.ts` sobre proteção de `/docs` | Descrevia uma decisão (x-api-key no Swagger) que já tinha sido revertida, com contagens antigas de rotas/permissions | ✅ Corrigido |
| F4 | README afirmava que `DATABASE_URL` é obrigatório até pra `prisma generate` | Falso — `prisma.config.ts` tem um valor de fallback só pra esse comando, que nunca conecta no banco de verdade | ✅ Corrigido |
| F5 | `npm audit` — a explicação de "são devDependencies, não entram no build" era imprecisa | `prisma` (CLI) é peer dependency **opcional** de `@prisma/client`, e entrava mesmo assim na imagem de produção via `npm ci --omit=dev`. Confirmado ao vivo: `--omit=dev` sozinho ainda tem as 4 vulnerabilidades; `--omit=dev --omit=optional` zera | ✅ Corrigido no `Dockerfile` e no README, com a real causa explicada |
| F7 | Senha de exemplo (`SenhaForte@123`) ainda aparece fora do Swagger (README §6, coleção do Postman) | Swagger já está mascarado (`********`), mas esses dois lugares não | ⏳ Aguardando decisão (Qwen marcou como "a critério") |
| F9 | CORS com `credentials: true` sempre ligado, mesmo sem `CORS_ORIGIN` definido | Hoje inofensivo (autenticação é via header, não cookie) — Qwen recomendou tornar `credentials` condicional só por defesa em profundidade | ⏳ Aguardando decisão (Qwen marcou como "a critério") |

## Arquivos-fonte recomendados pra subir no NotebookLM

- `docs/fases/PACOTE-QWEN-REVISAO-DEFINITIVA.md` — o pedido completo
- (a resposta colada do Qwen, se você quiser salvá-la como
  `PARECER-QWEN-REVISAO-DEFINITIVA.md` antes de subir)
- `src/common/interceptors/logging.interceptor.ts` e
  `src/common/filters/global-exception.filter.ts` — o antes/depois do F2
- `src/common/filters/global-exception.filter.spec.ts` — os testes novos
  que travam a regra do F2
- Este arquivo

## Prompt sugerido pro NotebookLM

> "Você é um tutor técnico explicando dois tipos de bug de
> instrumentação (não de regra de negócio) num backend NestJS. Baseado
> nas fontes: (1) explique com uma analogia do dia a dia por que um
> componente que 'anota o que aconteceu antes de saber o resultado
> final' produz registros que mentem, mesmo que o sistema em si esteja
> se comportando corretamente; (2) explique por que ter três ferramentas
> de verificação diferentes (build, testes, linter) não garante ausência
> de erros de tipo, e por que rodar o compilador em modo 'só checar' é um
> passo separado e necessário; (3) para cada um dos outros achados
> (contagens desatualizadas, comentário obsoleto, variável de ambiente
> mal documentada, dependência opcional vazando pra produção), explique
> em uma frase por que pequenas inconsistências de documentação também
> custam pontos numa avaliação técnica, mesmo sem afetar o código
> funcionando. Gere como um podcast em formato conversa entre um
> engenheiro júnior confuso e um sênior explicando com paciência, tom
> didático."
