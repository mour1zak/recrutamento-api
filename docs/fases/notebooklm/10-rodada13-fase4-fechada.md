# Etapa 10: Rodada 13 — Fase 4 fechada (APROVADO COM RESSALVAS)

> Pacote-fonte pra colar no NotebookLM. Fecha o ciclo da Fase 4: reprovada
> na Rodada 12 com 6 críticos, todos corrigidos, reatacados com MAIS força
> do que a que os encontrou, e agora aprovados. O achado mais interessante
> desta rodada não é um bug do código — é um bug da PRÓPRIA CORREÇÃO
> anterior, pego só por insistir em rodar a suíte várias vezes.

## O que aconteceu, em linguagem simples

Depois de corrigir os 6 problemas da rodada anterior, mandamos o código
de volta pro Qwen atacar de novo — só que desta vez com o dobro (ou mais)
de tentativas simultâneas do que ele usou pra encontrar os problemas
originalmente. Todos os seis se sustentaram: as taxas de falha que
chegavam a 100% caíram pra zero, mesmo sob pressão maior. Ele aprovou,
com um punhado de pendências pequenas de documentação — nada de
segurança.

## A parte mais interessante: um erro que só apareceu depois de corrigido

Uma das exigências da rodada era simples: quando duas ações concorrentes
esbarram uma na outra, o erro devolvido precisa dizer POR QUE (um código
que um programa cliente consegue reconhecer automaticamente), não só "deu
erro, tente de novo" sem explicação. Corrigimos isso — mas só num lugar.

O sistema tem, na verdade, TRÊS caminhos diferentes por onde esse mesmo
tipo de erro de concorrência pode passar (pense em três portas diferentes
que levam pro mesmo corredor). A correção inicial só colocou a placa de
identificação numa das três portas. Só descobrimos isso rodando a
bateria de testes várias vezes seguidas: nas duas primeiras vezes, o erro
passou pela porta certa (com a placa). Na terceira e quarta vez, ele
passou por uma das OUTRAS duas portas — sem placa nenhuma. Se
tivéssemos rodado só uma vez, teríamos declarado "corrigido" com um erro
que ainda tinha 2/3 de chance de aparecer sem explicação.

**A lição:** para um problema que só acontece de vez em quando (por
depender de timing exato entre duas ações simultâneas), rodar o teste
uma única vez não prova nada — só prova que, DESSA vez, não aconteceu.

## Os seis críticos, resumidos rapidamente (detalhes na etapa anterior)

1. Contratação x redução de vagas — corrigido, testado até com a
   quantidade de vagas mudando duas vezes seguidas no meio da disputa.
2 e 3. As duas travas de "nunca zero" (permissão de gerenciar papéis, e
   administrador ativo) — corrigidas, testadas com o DOBRO de tentativas
   simultâneas da rodada anterior, sempre seguras.
4. Formulário incompleto quebrando o servidor — corrigido, confirmado com
   4 variações diferentes de corpo de requisição.
5. Empresa desativada ainda dando acesso — corrigido nas 9 rotas testadas
   (a rodada anterior só tinha achado 4).
6. Documento vazando pra quem não devia — corrigido, e o auditor também
   testou os 4 tipos de documento possíveis pra confirmar que a regra
   ficou consistente.

## Uma lacuna descoberta como consequência da própria correção

Ao corrigir o vazamento de documentos (#6), ficou visível uma limitação
que já existia, mas que a versão com bug "escondia" por acidente: hoje só
existe UM espaço pra anexar documento a uma candidatura, e é sempre o do
currículo. Isso significa que carta de apresentação, certificado ou
outros tipos de documento nunca ficam visíveis a um recrutador — mesmo
que o candidato os tenha enviado. Não é um bug da correção; é uma
limitação de desenho que a correção revelou. A decisão, por ora: manter
assim e documentar claramente, deixando uma solução mais completa
(permitir vários documentos por candidatura, com o candidato escolhendo
o que compartilhar) registrada para depois.

## Como validamos

Além de repetir os mesmos tipos de teste de concorrência da rodada
anterior com mais tentativas simultâneas, desta vez também confirmamos
que o "freio de mão" do banco de dados (a regra que impede fisicamente um
número impossível de ser salvo, não importa o que o código faça) está
realmente instalado e funcionando — disparamos ele de propósito e
confirmamos que o erro que ele produz também sai no formato correto, não
como uma falha genérica do servidor.

## Arquivos-fonte recomendados pra subir no NotebookLM

- `docs/fases/PARECER-QWEN-FASE4-RODADA13.md` — relatório condensado
- `docs/fases/TRIAGEM-REVISOES-RODADA13.md` — resposta item a item,
  incluindo o relato de como o erro dos "3 caminhos" foi descoberto
- `src/common/filters/global-exception.filter.ts` — os 3 lugares que
  agora identificam o mesmo tipo de erro de concorrência
- Este arquivo

## Prompt sugerido pro NotebookLM

> "Você é um tutor técnico explicando pra um engenheiro por que testar
> uma correção de concorrência UMA VEZ não é prova suficiente. Baseado
> nas fontes: (1) explique com uma analogia simples por que um mesmo tipo
> de erro pode ter vários 'caminhos' diferentes até o cliente, e por que
> corrigir só um caminho pode parecer que resolveu o problema num teste
> isolado; (2) explique por que rodar a mesma bateria de testes várias
> vezes seguidas é uma prática de qualidade específica pra bugs de
> concorrência, diferente de bugs comuns (que ou acontecem sempre ou
> nunca acontecem); (3) comente a decisão de documentar uma limitação
> (só currículo pode ser anexado) em vez de tentar resolver tudo de uma
> vez — quando essa é a escolha certa e quando não é. Gere como um
> podcast em formato conversa técnica descontraída entre dois
> engenheiros revisando o fechamento de uma fase de projeto."
