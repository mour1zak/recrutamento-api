# Etapa 6: Rodada 10 do Qwen — REPROVADO, vazamento de PII no CandidateProfile

> Pacote-fonte pra colar no NotebookLM e gerar um podcast/relatório de
> entendimento desta etapa — a primeira vez que a reprovação foi por
> vazamento de dado pessoal (PII), não por isolamento entre empresas ou
> concorrência.

## O que aconteceu, em linguagem simples

O módulo CandidateProfile guarda dado sensível de verdade: telefone,
endereço, resumo pessoal do candidato. Pedimos ao Qwen pra atacar
especificamente "quem consegue ver o quê, sob qual condição" — e ele
achou dois caminhos, usando credenciais legítimas (nada de invasão), em
que uma pessoa via mais dado do que devia.

## Os dois críticos, e por que cada um importa

**1. Recrutador de empresa desativada continuava lendo o perfil
completo.** Quando um administrador desativa uma empresa, o recrutador
daquela empresa não devia mais conseguir nada em nome dela — isso já
tinha sido corrigido pra "criar vaga" na Rodada 8. Só que ninguém tinha
verificado a mesma regra pro lado da LEITURA: o recrutador continuava
lendo telefone, resumo e endereço de qualquer candidato que tivesse se
candidatado a uma vaga da empresa dele, mesmo depois da empresa ser
desativada — porque o acesso vem de uma candidatura histórica, que nunca
é apagada. Ou seja: o efeito não é temporário, é permanente.

**2. Candidato retirar a própria candidatura aumentava a exposição dele
mesmo.** A regra de "quando o recrutador vê o perfil completo em vez de
só nome e habilidades" estava escrita como uma negação: "mostra tudo,
EXCETO se o status for `PENDING`". Isso parece razoável até você
perceber que qualquer status novo que alguém esqueça de excluir também
libera o dado — e foi exatamente o que aconteceu com `WITHDRAWN`
(candidato desistiu) e `REJECTED` (candidato foi rejeitado). O pior caso:
o candidato **desistir** da vaga, uma ação que devia reduzir o quanto ele
está exposto, tinha como efeito colateral o oposto — o recrutador passava
a ver o perfil completo dele. E `REJECTED` é o desfecho mais comum de
todos: rejeitar alguém passava a conceder acesso permanente ao contato
dessa pessoa.

## O padrão por trás dos dois (o achado mais importante do relatório)

De novo o mesmo padrão que já apareceu antes nesta avaliação: uma regra
de decisão foi implementada como **negação** ("tudo, exceto X") em vez de
**lista positiva nomeada** ("só nestes casos específicos"). Uma negação
cresce sozinha — todo status novo, ou todo caso que ninguém pensou em
excluir, cai automaticamente do lado errado. Uma lista positiva só cresce
quando alguém decide conscientemente adicionar um caso.

O Qwen também apontou que a checagem "essa empresa está ativa?" já
existia extraída num lugar só (`hasJobScope`/`isAdmin`) no módulo Jobs,
mas aqui, no CandidateProfile, a mesma pergunta foi respondida de novo,
inline, duplicada — o mesmo tipo de duplicação que causou o crítico
C1 da Rodada 8.

## Como cada correção funciona

1. **Empresa desativada:** `getByUserId()` (a função que busca o perfil
   pra exibir a um recrutador) agora confere se a empresa do recrutador
   ainda está ativa **antes** de consultar a candidatura — mesmo padrão
   já usado em Jobs, aplicado ao lado que faltava (leitura).
2. **Status que libera o perfil completo:** trocamos a negação por uma
   lista nomeada e explícita — `UNDER_REVIEW`, `INTERVIEW`, `OFFERED`,
   `HIRED`. Qualquer outro status (incluindo `PENDING`, `REJECTED`,
   `WITHDRAWN`, e qualquer status futuro que alguém crie) cai do lado
   restrito por padrão.
3. **Efeito colateral encontrado no caminho:** o mesmo `upsert` que salva
   o perfil tinha uma corrida de concorrência que devolvia um erro
   "já existe" falso pra 37,5% das edições simultâneas do próprio
   candidato no seu próprio perfil — corrigido detectando esse caso
   específico e tratando como uma atualização normal, não um conflito.

## Como validamos

Teste por status (`PENDING`, `REJECTED`, `WITHDRAWN` → perfil reduzido;
`UNDER_REVIEW`, `INTERVIEW`, `OFFERED`, `HIRED` → perfil completo), teste
de escopo cross-tenant (mesmo candidato com candidaturas em duas empresas
diferentes, cada uma vendo só o que devia), e reprodução manual contra o
servidor rodando de verdade: candidatura mudada pra `WITHDRAWN` → o
recrutador passou a ver só nome/headline/skills; empresa desativada →
`GET` do perfil do candidato passou a devolver "não encontrado" no lugar
de `200` com telefone.

## Arquivos-fonte recomendados pra subir no NotebookLM

- `docs/fases/PARECER-QWEN-FASE3-CANDIDATEPROFILE-RODADA10.md` — o
  relatório original condensado
- `docs/fases/TRIAGEM-REVISOES-RODADA10.md` — resposta item a item
- `src/candidate-profile/candidate-profile.service.ts` — o arquivo com
  as correções (procure por `STATUSES_THAT_UNLOCK_FULL_PROFILE`)
- `test/candidate-profile.e2e-spec.ts` — os testes novos (procure por
  "C1", "P4", "cross-tenant")
- Este arquivo

## Prompt sugerido pro NotebookLM

> "Você é um tutor técnico explicando pra um engenheiro que é o
> arquiteto responsável pela entrega desta avaliação, quer entender a
> fundo os erros encontrados e evitar repeti-los nos próximos módulos.
> Baseado nas fontes: (1) explique cada um dos dois achados críticos com
> uma analogia do dia a dia, deixando claro por que vazamento de dado
> pessoal (PII) é uma categoria de risco diferente de bug funcional; (2)
> explique por que escrever uma regra como negação ('tudo, exceto X') é
> mais perigoso que escrever como lista positiva, usando o caso de
> `WITHDRAWN` como exemplo concreto; (3) explique o que significa 'lógica
> de decisão duplicada entre módulos' e por que isso preocupa mesmo
> quando, no momento, os dois lugares concordam; (4) sugira 2 perguntas
> que valeriam a pena fazer antes de começar o PRÓXIMO módulo
> (Application), já que ele vai decidir a mesma pergunta de escopo uma
> terceira vez. Gere como um podcast em formato 'post-mortem de
> incidente de privacidade', sem apontar culpado, focado em aprendizado
> de processo."
