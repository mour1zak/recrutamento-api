# Etapa 4: Rodada 9 do Qwen — APROVADO, Fase 3 (Companies + Jobs) fechada

> Pacote-fonte pra colar no NotebookLM — desta vez uma história de
> "aprovado depois de reprovado", que vale entender pelo que ela prova
> sobre o processo, não só pelo resultado.

## O que aconteceu, em linguagem simples

Na etapa anterior, o Qwen reprovou o módulo de vagas com três problemas
sérios de segurança/concorrência. Corrigimos os três e pedimos pra ele
tentar quebrar de novo — só que desta vez com mais força: em vez de
testar a corrida de concorrência 25 vezes, ele testou quase 100 vezes;
em vez de testar um usuário só, ele testou toda combinação possível de
papel e empresa.

**Resultado: os três problemas continuaram corrigidos.** Nenhum voltou.
Isso é uma prova mais forte do que "corrigimos e passou uma vez" — é
"corrigimos, atacamos de novo com o dobro de força, e ainda segurou".

## Os dois achados novos (nenhum grave)

**1. O próprio TESTE que escrevemos pra provar a correção tinha um erro
de lógica.** Isso é interessante: o código estava certo, mas a forma
como verificávamos se ele estava certo, não. Explicando: quando duas
pessoas tentam mudar o status de uma vaga ao mesmo tempo (uma quer
"pausar", outra quer "cancelar"), existe uma sequência de eventos
perfeitamente legítima onde as duas ações são aceitas — porque a segunda
ação, na prática, aconteceu DEPOIS da primeira ter sido aplicada, não ao
mesmo tempo de verdade. Nosso teste assumia erradamente que só uma das
duas podia ter sucesso, e por isso falhava, "por engano", em 1 a cada 20
execuções. Corrigimos o teste pra verificar a coisa certa: nunca dá erro
de servidor, e uma vez que uma vaga é cancelada de verdade, nada consegue
desfazer isso depois.

**2. Uma "porta dos fundos" que só existiria se outro recurso, ainda não
construído, existisse.** O sistema hoje decide "este é um administrador
de verdade?" olhando o NOME do papel da pessoa ("ADMIN"). O Qwen mostrou
que, se um dia alguém puder editar papéis livremente (uma funcionalidade
planejada pra mais pra frente, chamada de "Nível B"), essa pessoa
poderia criar um papel FALSO também chamado "ADMIN" e ganhar acesso
irrestrito — ou pior, renomear o admin de verdade e roubar o acesso dele.
Hoje isso não é alcançável de jeito nenhum (a funcionalidade que
permitiria isso nem existe ainda), então não bloqueou a aprovação — mas
já ficou anotado como uma condição obrigatória pra quando esse recurso
for construído.

## Por que "aprovado depois de reprovado" é a etapa mais importante até agora

Isso prova que o processo de auditoria adversarial está funcionando do
jeito que deveria: encontrar problema de verdade, corrigir de verdade, e
depois testar de novo com mais rigor pra garantir que a correção não foi
só "fingir que resolveu". A alternativa (aceitar a primeira correção sem
questionar) é exatamente o tipo de confiança cega que já causou os
mesmos três tipos de erro (uma regra escrita mas não seguida em todo
lugar) quatro vezes neste projeto.

## Arquivos-fonte recomendados pra subir no NotebookLM

- `docs/fases/PARECER-QWEN-FASE3-DOMINIO-RODADA9.md`
- `test/jobs.e2e-spec.ts` (procure por "C2" pra ver o teste corrigido)
- `src/jobs/jobs.service.ts` (procure por "findOne" e "findPublicList")
- Este arquivo

## Prompt sugerido pro NotebookLM

> "Você é um tutor técnico explicando pra um engenheiro que é o
> arquiteto responsável por esta entrega. Baseado nas fontes: (1)
> explique com um exemplo concreto por que um teste de concorrência pode
> estar 'errado' mesmo quando o código que ele testa está certo — e como
> perceber a diferença; (2) explique o conceito de 'controle de acesso
> por nome' vs. 'controle de acesso por permissão' (o achado sobre o
> papel 'ADMIN'), com uma analogia do mundo real (ex.: crachá com nome
> escrito à mão vs. crachá com chip de acesso); (3) resuma por que uma
> segunda rodada de auditoria mais rigorosa depois de uma correção é
> mais confiável do que aceitar a primeira correção sem questionar. Gere
> como um podcast curto (10 minutos), tom de celebração comedida — é uma
> vitória real, mas o foco deve estar no PROCESSO que permitiu perceber
> isso, não em comemorar sem entender o porquê."
