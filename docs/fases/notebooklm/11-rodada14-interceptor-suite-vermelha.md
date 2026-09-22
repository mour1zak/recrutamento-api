# Etapa 11: Rodada 14 — reprovado por um teste, não pelo código

> Pacote-fonte pra colar no NotebookLM. A lição desta rodada não é sobre
> o interceptor (que passou em quase tudo) — é sobre como um teste de
> concorrência mal escrito pode fazer você acreditar que algo está
> funcionando quando só teve sorte.

## O que aconteceu, em linguagem simples

Depois de fechar a Fase 4, implementamos o último item obrigatório que
faltava (um interceptor de log). Mandamos pro Qwen validar — uma revisão
pequena, focada. Ele reprovou. Mas o motivo não foi o interceptor: foi
que a suíte de testes que declaramos "100% verde" na verdade falhava
**92% das vezes** quando ele rodou um arquivo específico isoladamente
várias vezes seguidas.

## Por que um teste "correto na maior parte do tempo" é pior que um teste sempre errado

Um teste de concorrência dispara duas ações ao mesmo tempo e confere o
resultado. Só que, quando duas coisas acontecem "ao mesmo tempo" de
verdade, existe mais de um jeito LEGÍTIMO de elas se resolverem — como
duas pessoas chegando numa porta giratória no mesmo instante: às vezes
uma passa primeiro por um triz, às vezes a outra. Os dois resultados são
igualmente corretos.

O teste que escrevemos verificava não só "o sistema terminou num estado
correto?" (que é a pergunta certa), mas também "o sistema chegou lá
EXATAMENTE por este caminho específico?" — uma pergunta boa demais, que
só uma das duas ordens de chegada satisfazia. Toda vez que a "outra"
ordem acontecia (o que, por sorte, é raro na maioria das vezes que você
roda o teste uma única vez), o teste falhava — mesmo o sistema estando
perfeitamente correto.

Rodando uma vez só, isso passa despercebido quase sempre. Rodando 12
vezes seguidas, a "má sorte" aparece 11 vezes.

## A correção

Trocar a pergunta do teste de "por qual caminho específico isso
aconteceu?" pra "o resultado final está correto, seja qual caminho for?"
— aceitando os dois desfechos legítimos, e continuando a exigir que o
estado final no banco de dados esteja sempre certo. É a MESMA lição que
o projeto já tinha aprendido numa rodada bem anterior (com um teste
diferente, mesmo tipo de erro) — o que mostra que vale a pena escrever a
regra geral de uma vez, não só corrigir caso a caso.

## E o interceptor, o que realmente estava sendo avaliado?

Passou em praticamente tudo: não vaza informação sensível no log, não
permite forjar entradas de log falsas, não interfere nos testes de
concorrência de rodadas anteriores, e não dá pra usar o tempo de resposta
logado pra descobrir segredos por diferença de velocidade. O único
achado real (não sobre o teste, sobre o próprio interceptor): rejeições
de acesso (chave de API errada, token inválido, permissão insuficiente)
e tentativas de acessar rotas que não existem **não geravam nenhuma
linha de log** — porque essas verificações acontecem numa etapa anterior
do sistema, antes do interceptor sequer começar a rodar. É exatamente o
tipo de tráfego mais interessante de registrar do ponto de vista de
segurança (tentativas de invasão, varredura de rotas). Corrigido
adicionando o mesmo tipo de registro no lugar certo do sistema (o filtro
de erros, que vê essas rejeições antes de qualquer interceptor).

## Como validamos desta vez

Depois de corrigir o teste, não bastava rodar uma vez — rodamos a suíte
completa 8 vezes seguidas, e o arquivo específico que causou o problema
mais 6 vezes isoladamente. 14 execuções limpas ao todo, correspondendo
ao mesmo nível de rigor que o próprio auditor usou pra encontrar o
problema.

## Arquivos-fonte recomendados pra subir no NotebookLM

- `docs/fases/PARECER-QWEN-INTERCEPTOR-RODADA14.md` — relatório condensado
- `docs/fases/TRIAGEM-REVISOES-RODADA14.md` — resposta completa
- `test/roles.e2e-spec.ts` — o teste corrigido (procure pela regra de
  concorrência escrita no comentário)
- Este arquivo

## Prompt sugerido pro NotebookLM

> "Você é um tutor técnico explicando por que 'o teste passou' não é o
> mesmo que 'o código está correto', especialmente em cenários de
> concorrência. Baseado nas fontes: (1) explique com uma analogia do dia
> a dia por que duas ações simultâneas podem ter mais de um resultado
> legítimo, e por que testar 'qual resultado específico aconteceu' é uma
> armadilha; (2) explique por que rodar um teste de concorrência UMA VEZ
> nunca é prova suficiente, e quantas vezes seria razoável rodar antes de
> confiar no resultado; (3) comente por que o mesmo tipo de erro
> reaparecer numa segunda ocasião no mesmo projeto é mais preocupante que
> o erro em si — o que isso sugere sobre precisar de uma regra escrita,
> não só uma correção pontual. Gere como um podcast em formato conversa
> entre um engenheiro júnior confuso e um sênior explicando com paciência,
> tom didático."
