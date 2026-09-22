# Etapa 7: Rodada 11 do Qwen — APROVADO COM RESSALVAS, Fase 3 fechada

> Pacote-fonte pra colar no NotebookLM e gerar um podcast/relatório de
> entendimento desta etapa — a primeira vez que o próprio auditor (Qwen)
> registrou que ele mesmo tinha deixado passar um problema em uma rodada
> anterior.

## O que aconteceu, em linguagem simples

Reapresentamos o módulo `CandidateProfile` depois de corrigir os dois
vazamentos de PII da Rodada 10. O Qwen atacou de novo, com mais força
ainda do que da primeira vez — e os dois problemas continuaram
corrigidos. Isso fecha a Fase 3 inteira (Companies, Jobs e
CandidateProfile, os três módulos de domínio já auditados).

Mas ele encontrou um problema novo — e explicou de onde ele veio: foi um
efeito colateral direto da PRÓPRIA correção da rodada anterior.

## O problema novo, com analogia

Pense em duas situações diferentes que hoje eram tratadas como se fossem
a mesma coisa: (1) você digita um CEP que **não existe** — o correio
confirma que aquele número simplesmente não corresponde a lugar nenhum;
(2) você digita um CEP válido, mas **o serviço de consulta está fora do
ar** no momento — o problema não é o CEP, é a ferramenta que devia
confirmá-lo. Na correção da rodada 10, tratamos as duas situações da
mesma forma: "não deu pra confirmar, então mantém o endereço que já
existia". Isso funciona bem pro caso 2 (falha temporária, não é culpa de
ninguém). Mas pro caso 1, isso criava um problema novo: o sistema
aceitava o CEP errado, escrevia ELE no cadastro, mas mantinha o endereço
do CEP ANTIGO — como se você trocasse o número da sua casa no formulário,
mas o sistema continuasse mostrando a rua onde você morava antes. O
registro passa a afirmar duas coisas que se contradizem.

## De onde veio o problema (o achado mais interessante do relatório)

Essa regra já estava escrita desde o começo do projeto — um documento de
planejamento da primeira fase já dizia exatamente como cada um dos dois
casos deveria se comportar: CEP que não existe deveria ser **rejeitado**;
falha de rede deveria **passar sem endereço, com um aviso**. Só que essa
regra nunca tinha sido realmente implementada — o código sempre tratou
os dois casos como idênticos. E o mais notável: o próprio Qwen, numa
auditoria de uma rodada bem anterior, tinha medido esse comportamento e
aprovado sem perceber que contradizia o próprio documento que o projeto
tinha adotado. Ele registrou isso abertamente no relatório desta rodada
— não como desculpa, mas como o mesmo tipo de falha que ele vem cobrando
da gente: "uma afirmação escrita que a execução não confirma", só que
desta vez quem não conferiu foi o auditor.

## Como a correção funciona

A função que consulta o CEP agora devolve três resultados possíveis, em
vez de só "deu certo" ou "deu branco":
1. **"Confirmado"** — o CEP existe e o endereço veio preenchido.
2. **"Inválido"** — o serviço confirma que aquele CEP não existe. Agora
   isso **rejeita a operação inteira** (nem o CEP errado nem qualquer
   outro campo daquela mesma requisição são salvos).
3. **"Indisponível"** — falha de rede/tempo esgotado. Continua não
   bloqueando nada, preserva o endereço anterior, e agora vem com um
   aviso explícito na resposta, coisa que também estava planejada desde
   o início e nunca tinha sido implementada.

## Outras correções da mesma rodada

Uma função pequena (`isAdmin`) que existia copiada em dois arquivos
diferentes foi movida pra um lugar só. Um script de preparação do banco
de testes quebrava em qualquer computador novo que clonasse o projeto
pela primeira vez — faltava um passo de geração de código antes de rodar
o resto; adicionado, e testado reproduzindo o erro de propósito antes de
confirmar a correção. E uma frase do README que descrevia uma regra
antiga (já corrigida numa rodada anterior) foi atualizada pra descrever a
regra atual.

## Como validamos

Suíte completa rodada 5 vezes seguidas sem falha (79 testes). O erro que
motivou a correção do script de banco foi reproduzido de propósito
(apagando o código gerado e tentando rodar o script antigo, vendo o
mesmo erro do relatório) antes de confirmar que a correção resolve.
Testado manualmente contra o servidor rodando de verdade: CEP inválido
agora recusa com um erro claro; CEP válido continua funcionando
normalmente, com o endereço preenchido.

## Arquivos-fonte recomendados pra subir no NotebookLM

- `docs/fases/PARECER-QWEN-FASE3-CANDIDATEPROFILE-RODADA11.md` — o
  relatório original condensado
- `docs/fases/TRIAGEM-REVISOES-RODADA11.md` — resposta item a item
- `src/common/cep/cep.service.ts` — o arquivo com o contrato novo
  (procure por `CepStatus`)
- Este arquivo

## Prompt sugerido pro NotebookLM

> "Você é um tutor técnico explicando pra um engenheiro que é o
> arquiteto responsável pela entrega desta avaliação, quer entender a
> fundo os erros encontrados e evitar repeti-los nos próximos módulos.
> Baseado nas fontes: (1) explique, com uma analogia do dia a dia, a
> diferença entre 'CEP que não existe' e 'serviço de consulta fora do ar'
> e por que tratar os dois da mesma forma criou um dado contraditório no
> banco; (2) explique por que um contrato de comportamento escrito num
> documento de planejamento, mas nunca implementado no código, é um risco
> tão real quanto um bug — mesmo quando ninguém percebe por várias
> rodadas de revisão; (3) comente o fato de o próprio auditor ter
> reconhecido publicamente que deixou passar esse problema numa auditoria
> anterior seguindo revalidação insuficiente — o que isso ensina sobre
> processos de revisão em geral, não só sobre este projeto; (4) sugira 2
> perguntas que valeriam a pena fazer antes de começar o módulo
> Application, já que ele vai decidir de novo se um consumidor externo
> (CEP, ou outro) pode devolver estados ambíguos. Gere como um podcast em
> formato conversa entre dois engenheiros seniores revisando o
> post-mortem juntos, tom curioso e sem apontar culpado."
