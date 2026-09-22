# Etapa 5: Módulo CandidateProfile — visibilidade em camadas

> Pacote-fonte pra colar no NotebookLM.

## O que foi construído, em linguagem simples

Terceiro módulo de domínio: o **perfil do candidato** — headline,
resumo, telefone, endereço (via CEP) e lista de habilidades. Duas rotas
simples (`ver o meu`, `atualizar o meu`) e uma terceira, mais
interessante, que decide **quanto** um recrutador pode ver do perfil de
um candidato dependendo de onde a candidatura dele está.

## A ideia central: visibilidade em camadas, não tudo-ou-nada

Pensa assim: quando você manda um currículo pra uma vaga, a empresa não
devia ver seu telefone pessoal e resumo completo **antes mesmo de decidir
se vai olhar sua candidatura de verdade**. Mas depois que ela começa a
avaliar de fato, faz sentido que veja tudo. É exatamente essa a regra:

- **Antes de qualquer avaliação** (candidatura ainda "pendente"): o
  recrutador vê só o básico — nome, título profissional, habilidades.
  Suficiente pra decidir se vale a pena olhar com atenção.
- **Depois que a empresa começou a avaliar** (mudou o status da
  candidatura pra "em análise" ou além): o recrutador passa a ver o
  perfil completo.
- **Sem candidatura nenhuma daquele candidato** pra empresa dele: o
  recrutador não vê **nada** — nem um "não autorizado", literalmente
  recebe a mesma resposta de "não existe" que receberia se o candidato
  nem tivesse conta no sistema.

## Uma decisão técnica interessante: usar uma peça que ainda não foi construída

O sistema de candidaturas ("Application") ainda não tem suas próprias
rotas — mas a estrutura de dados dele já existe desde o planejamento
inicial do banco. Pra decidir "esse recrutador pode ver esse perfil?",
precisamos saber se existe uma candidatura ligando os dois — e
conseguimos perguntar isso direto ao banco de dados, mesmo sem ainda ter
construído a "porta de entrada" (a rota da API) pra esse sistema. É
como perguntar "essa pessoa já reservou mesa neste restaurante?" olhando
direto o livro de reservas, mesmo antes do restaurante ter um sistema de
recepção pronto.

## Como validamos

12 testes automatizados cobrindo cada camada de visibilidade: perfil
inexistente, dono vendo o próprio, administrador vendo qualquer um,
tentativa de ver perfil de quem não é candidato, candidato tentando ver
outro candidato sem relação nenhuma, recrutador sem candidatura, e as
duas transições de estado da candidatura (pendente → em análise) com o
mesmo perfil mudando de reduzido pra completo automaticamente.

## Arquivos-fonte recomendados pra subir no NotebookLM

- `src/candidate-profile/candidate-profile.service.ts` — a lógica de
  visibilidade
- `test/candidate-profile.e2e-spec.ts`
- Este arquivo

## Prompt sugerido pro NotebookLM

> "Você é um tutor técnico explicando pra um engenheiro que é o
> arquiteto responsável por esta entrega. Baseado nas fontes: (1)
> explique o conceito de 'visibilidade em camadas' deste módulo com uma
> analogia do mundo real (processo seletivo de emprego de verdade); (2)
> explique por que a resposta pra quem não deveria ver um perfil é
> sempre 'não encontrado' e nunca 'não autorizado', e por que essa
> diferença importa pra segurança; (3) aponte 2 perguntas que um auditor
> faria sobre consultar uma tabela de um módulo que ainda não existe como
> API própria. Gere como um podcast curto, tom didático."
