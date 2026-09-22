# Etapa 9: Rodada 12 — Fase 4 reprovada, 6 críticos, todos corrigidos

> Pacote-fonte pra colar no NotebookLM. A previsão da etapa anterior se
> confirmou: implementar 5 módulos de uma vez sem auditoria prévia trouxe
> os mesmos tipos de bug que já apareceram (e foram corrigidos) em
> módulos anteriores — só que desta vez em maior quantidade de uma vez.

## O que aconteceu, em linguagem simples

Mandamos os 5 módulos da etapa anterior (Application, Interview,
Document, Users, RBAC) pro Qwen atacar pela primeira vez. Ele achou 6
problemas críticos — todos reproduzidos executando o código de verdade,
não só lendo. O padrão é revelador: os 3 primeiros são a mesma classe de
bug ("checar antes de escrever, sem garantir que nada mudou no meio do
caminho") que o projeto já encontrou e consertou três vezes antes; os
outros 3 são "esquecer de aplicar uma proteção que já existia em outro
lugar do código".

## Os 6 problemas, com analogia

**1. Contratar sem vender vaga demais, com um furo sutil.** A trava
"não deixa contratar mais gente do que tem vaga" funcionava — MAS só
enquanto ninguém mexesse no número de vagas ao mesmo tempo. Pense num
caixa de banco contando "tem dinheiro suficiente pra esse saque?" usando
o saldo que ele viu no início do dia, não o saldo atualizado no
momento exato do saque. Se alguém depositar ou sacar no meio do
caminho, a conta do caixa fica errada. Corrigido: agora a conferência é
sempre contra o número EXATO no banco, no instante exato da escrita —
não um número guardado de antemão.

**2 e 3. As duas travas de "não pode ficar sem nenhum".** O sistema tem
duas regras parecidas: "não pode ficar sem nenhum administrador" e
"não pode ficar sem nenhum papel que consiga gerenciar permissões". As
duas tinham o MESMO problema: contar quantos existem e decidir "pode
prosseguir" em um passo, e só DEPOIS escrever a mudança, em outro passo
separado. Se duas pessoas fizerem a mesma pergunta ao mesmo tempo, as
duas podem ouvir "sim, pode", e as duas mudarem — juntas, deixando ZERO.
É como duas pessoas perguntando separadamente "ainda tem vaga na sala?"
e as duas ouvirem "sim, tem uma" antes de qualquer uma entrar — as duas
entram, e a sala fica cheia demais. A correção usa uma trava que o
projeto já tinha inventado pra um problema idêntico (desativar o último
administrador): perguntar e escrever como uma coisa só, indivisível.

**4. Um formulário incompleto quebrando o servidor inteiro.** Enviar um
pedido de "mudar a empresa de um recrutador" sem preencher o campo da
empresa (em vez de mandar "sem empresa" explicitamente) travava o
servidor com um erro genérico, em vez de dizer educadamente "faltou um
campo". Corrigido distinguindo "campo vazio de propósito" de "campo
esquecido".

**5. Empresa desativada, mas o crachá continuava funcionando em 3
portas.** Quando uma empresa é desativada, o recrutador dela não deveria
mais conseguir nada. Isso já funcionava em alguns lugares do sistema,
mas os 3 módulos novos (candidaturas, entrevistas, documentos) tinham
esquecido de instalar a mesma trava — o recrutador continuava lendo
candidaturas, agendando entrevistas e, o mais grave, **baixando
currículos** de uma empresa que já devia estar sem acesso a nada.

**6. Um documento vazando pra quem nunca devia vê-lo.** A regra dizia
"o recrutador só vê documentos que o candidato enviou PARA a candidatura
dele". Na prática, bastava existir QUALQUER candidatura qualificada
daquele candidato na empresa pra liberar TODOS os documentos dele —
inclusive um documento pessoal que o candidato nunca anexou a candidatura
nenhuma. Corrigido pra só liberar o documento que foi de fato anexado.

## O padrão por trás de tudo (a lição mais importante)

Todas as 6 correções JÁ EXISTIAM em algum lugar do projeto antes desta
rodada — a trava certa pra "não deixar sem nenhum" já tinha sido
inventada; a trava certa pra "empresa desativada" já tinha sido
extraída num lugar reutilizável. O que faltou não foi criatividade, foi
PROPAGAÇÃO: garantir que toda parte nova do sistema realmente usa as
soluções que já existem, em vez de reescrever a lógica do zero (e
esquecer um detalhe importante no caminho).

## Como validamos

Pra cada um dos 3 problemas de concorrência, criamos um teste que
dispara duas ações ao mesmo tempo, repetidamente, e confere que o
resultado nunca viola a regra de negócio — não "confere se deu
exatamente uma resposta de sucesso", que é uma forma de testar que já se
provou enganosa antes neste projeto. Pros outros 3, testamos
diretamente que a proteção que faltava agora está no lugar certo.

## Arquivos-fonte recomendados pra subir no NotebookLM

- `docs/fases/PARECER-QWEN-FASE4-RODADA12.md` — o relatório original
  condensado
- `docs/fases/TRIAGEM-REVISOES-RODADA12.md` — resposta item a item
- `src/applications/applications.service.ts` — a correção da
  contratação (procure por `$executeRaw`)
- Este arquivo

## Prompt sugerido pro NotebookLM

> "Você é um tutor técnico ajudando um engenheiro a entender por que um
> código que parecia bem escrito falhou numa auditoria adversarial.
> Baseado nas fontes: (1) explique com uma analogia do dia a dia por que
> 'verificar antes de escrever' não é suficiente quando duas pessoas
> podem verificar ao mesmo tempo, e por que a solução certa é tornar a
> verificação e a escrita uma coisa só, indivisível; (2) explique a
> diferença entre 'a solução certa não existe' e 'a solução certa existe,
> mas não foi aplicada em todo lugar que precisava dela' — por que esse
> segundo tipo de falha é mais perigoso, já que passa despercebido com
> mais facilidade; (3) sugira 2 práticas de processo (não de código) que
> ajudariam a pegar esse tipo de lacuna de propagação antes de uma
> auditoria externa. Gere como um podcast em formato 'retrospectiva de
> incidente', tom construtivo, sem apontar culpado."
