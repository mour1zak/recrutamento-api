# Etapa 3: Rodada 8 do Qwen — REPROVADO, três críticos, todos corrigidos

> Pacote-fonte pra colar no NotebookLM e gerar um podcast/relatório de
> entendimento desta etapa — a primeira vez que um módulo de domínio foi
> reprovado, não só recebeu ressalvas.

## O que aconteceu, em linguagem simples

Pedimos ao Qwen pra atacar de propósito três pontos específicos do
módulo Jobs: (1) tentar quebrar o isolamento entre empresas, (2) tentar
provocar a corrida de concorrência que nós mesmos avisamos que existia,
e (3) verificar se as mensagens de erro vazavam alguma informação
interna. Ele reprovou com três achados críticos nos dois primeiros
pontos — e confirmou que o terceiro estava limpo.

## Os três problemas, e por que cada um importa

**1. Um usuário sem empresa tinha acesso a TUDO.** O usuário de teste
"recrutador" que o projeto cria automaticamente (pra facilitar login
durante o desenvolvimento) nunca tinha sido vinculado a uma empresa
específica. O código tratava "sem empresa" como "pode mexer em qualquer
empresa" — o oposto do que devia ser. Usando só a senha pública desse
usuário de teste (documentada no próprio repositório), foi possível
editar, cancelar e até **criar e publicar uma vaga fingindo ser de uma
empresa que não é a sua**. É exatamente a regra que o enunciado da
avaliação exige ("recrutador só mexe em vaga da própria empresa"),
quebrada.

**2. Duas pessoas mudando o status da mesma vaga ao mesmo tempo
corrompiam o estado.** Imagine duas pessoas clicando "cancelar vaga" e
"pausar vaga" no exato mesmo segundo. O sistema deveria aceitar só uma
das duas (a vaga não pode estar cancelada E pausada). Só que, quando as
duas chegavam realmente juntas, as duas passavam pela validação antes de
qualquer uma escrever no banco — e a última a escrever vencia, mesmo que
isso significasse "reabrir" uma vaga que tinha acabado de ser cancelada
definitivamente. Em mais da metade dos testes (13 de 25), isso aconteceu
de verdade.

**3. Desativar uma empresa não desativava nada de verdade.** Quando um
administrador desativa uma empresa, o esperado é que ninguém daquela
empresa consiga mais fazer nada em nome dela. Só que os recrutadores
daquela empresa continuavam criando e publicando vagas normalmente — as
vagas apareciam pro público, mesmo com a empresa "oficialmente"
desativada.

## O padrão por trás dos três (o achado mais importante do relatório)

O Qwen apontou algo que vale mais que os três bugs individuais: **os
três nasceram de um comentário no código que afirmava uma regra que o
código, na prática, não seguia em todos os lugares** — "isso só acontece
com admin", "esses dois estados nunca mudam", "isso vai ser tratado
depois". Nas três vezes, ninguém tinha testado pra confirmar que a
afirmação era verdadeira. É a quarta vez que esse padrão específico
aparece nesta avaliação.

## Como cada correção funciona

1. **Isolamento:** criamos UMA função só, num lugar só, que decide "este
   usuário pode mexer nesta vaga?" — em vez de três pedaços de código
   respondendo essa pergunta de jeitos diferentes. E o usuário de teste
   "recrutador" agora nasce **com** uma empresa vinculada.
2. **Corrida de concorrência:** em vez de "ler o status, decidir, depois
   escrever" (três passos separados, onde outra pessoa pode interferir no
   meio), a escrita agora é uma operação só: "só muda o status SE ele
   ainda for o mesmo que eu li". Se alguém mudou no meio do caminho, a
   segunda pessoa recebe um erro claro em vez de sobrescrever silenciosamente.
3. **Empresa desativada:** toda ação de escrever numa vaga (criar,
   editar, mudar status) agora confere se a empresa dona ainda está
   ativa antes de prosseguir.

## Como validamos

Testes automatizados novos usando o usuário de teste REAL (não um
fabricado especialmente pro teste, que teria escondido o problema de
novo) e um teste que dispara duas mudanças de status ao mesmo tempo,
com `Promise.all`. Além disso, reproduzimos os três ataques manualmente
contra o servidor rodando de verdade, e todos os três agora voltam
"não encontrado" ou "conflito" em vez de aceitar a ação indevida.

## Arquivos-fonte recomendados pra subir no NotebookLM

- `docs/fases/PARECER-QWEN-FASE3-DOMINIO-RODADA8.md` — o relatório
  original condensado
- `src/jobs/jobs.service.ts` — o arquivo com as três correções
- `test/jobs.e2e-spec.ts` — os testes novos (procure por "C1", "C2", "C3")
- Este arquivo

## Prompt sugerido pro NotebookLM

> "Você é um tutor técnico explicando pra um engenheiro que é o
> arquiteto responsável pela entrega desta avaliação, quer entender a
> fundo os erros encontrados e evitar repeti-los nos próximos módulos.
> Baseado nas fontes: (1) explique cada um dos três achados críticos com
> uma analogia do dia a dia; (2) explique por que os três compartilham a
> mesma causa raiz ('uma regra em comentário que o código não aplica em
> todo lugar') e o que isso ensina sobre como escrever código seguro daqui
> pra frente; (3) sugira 2 perguntas que valeriam a pena fazer antes de
> começar o PRÓXIMO módulo (Application), pra não cair no mesmo padrão de
> novo. Gere como um podcast em formato 'post-mortem de incidente' — like
> uma retrospectiva de equipe de engenharia depois de um bug sério, sem
> apontar culpado, focado em aprendizado de processo."
