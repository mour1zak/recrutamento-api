# Etapa 8: Fase 4 — Application, Interview, Document, Users, RBAC Nível B

> Pacote-fonte pra colar no NotebookLM. Diferente das etapas anteriores,
> esta ainda **não passou por auditoria do Qwen** — é a implementação
> inicial de 5 módulos de uma vez, sob um orçamento de tempo apertado
> (últimas ~4h de produção). Serve tanto pra estudo quanto de material de
> apoio pra revisão manual antes de mandar pro Qwen.

## O que aconteceu, em linguagem simples

Até aqui, cada módulo (Companies, Jobs, CandidateProfile) passou pelo
mesmo ciclo: eu implemento, o Qwen ataca de propósito, alguma coisa
quebra, eu conserto, ele ataca de novo, aprova. Esse ciclo levou a maior
parte do tempo do projeto. Com o prazo apertando, a decisão (do usuário,
consciente do trade-off) foi implementar os 5 módulos que faltavam de uma
vez só, aplicando os MESMOS padrões que essas 3 rodadas de auditoria já
provaram funcionar — mas sem repetir o ciclo completo de ataque
adversarial antes de entregar. É importante entender que isso é uma
aposta calculada, não uma garantia: os 3 módulos anteriores só ficaram
bons DEPOIS de serem atacados. Estes 5 nunca foram.

## Os 5 módulos, um por um

### 1. Application — a candidatura em si

**O que é:** o coração do sistema. Um candidato se candidata a uma vaga;
isso cria um registro que passa por uma sequência de status até virar
contratação ou rejeição.

**As duas regras obrigatórias do enunciado, e como cada uma foi
garantida:**
- *Candidatura duplicada proibida* — não implementei isso checando "essa
  pessoa já se candidatou?" antes de criar (esse tipo de checagem tem uma
  brecha: duas requisições podem checar ao mesmo tempo, ambas verem "não
  existe" e as duas criarem). Em vez disso, o PRÓPRIO BANCO tem uma regra
  ("essa combinação de candidato+vaga só pode aparecer uma vez"), e eu
  deixo o banco recusar a segunda tentativa. É como ter uma trava na
  porta em vez de confiar que ninguém mais vai tentar entrar.
- *Vaga inativa não aceita candidatura* — reusei exatamente a mesma regra
  que decide se uma vaga aparece pra um candidato de fora (`Jobs`,
  Rodada 9): só é "candidatável" o que é "visível publicamente" (vaga
  `OPEN` de uma empresa ativa). Vaga que não existe, ou empresa
  desativada → mesma resposta (nunca revela qual dos dois motivos é).

**A parte mais delicada: contratar sem "vender mais vagas do que tem".**
Imagine uma vaga com 1 posição, e dois candidatos que chegaram na fase
final ao mesmo tempo. Se um recrutador clica "contratar" pro candidato A
e, no MESMO instante, outro recrutador (ou o mesmo, duas abas) clica
"contratar" pro candidato B, só UM pode ganhar a vaga. A solução usa o
mesmo truque já provado em Jobs: a atualização do contador de vagas
preenchidas é condicional — "só aumenta o contador SE ele ainda não bateu
o limite" — e o próprio banco de dados garante que essa checagem-e-escrita
acontece como uma coisa só, sem brecha, mesmo com duas pessoas tentando
ao mesmo tempo. Testado de verdade: disparei as duas contratações
simultaneamente, e confirmei que exatamente uma virou sucesso.

**Quem vê o quê:** um recrutador só vê o currículo completo de um
candidato depois que a candidatura avança de "recebida" pra "em
avaliação" — mesma regra (mesma LISTA, não a mesma negação que causou o
bug da Rodada 10) que já existia no perfil do candidato.

### 2. Interview — agendamento de entrevistas

**O que é:** depois que uma candidatura chega na fase "entrevista", o
recrutador agenda um horário. A parte incomum é REAGENDAR: em vez de só
mudar a data na mesma entrevista, o sistema cria uma entrevista NOVA e
marca a antiga como "substituída" — preservando o histórico completo de
quantas vezes uma entrevista foi remarcada e quando. Pense em como um
sistema de rastreamento de encomendas nunca apaga o "saiu para entrega"
antigo quando o pacote é redirecionado — ele adiciona um novo evento.

**Por que isso importa:** se alguém perguntar "por que essa entrevista
foi remarcada 3 vezes?", o histórico está lá, entrevista por entrevista,
em vez de uma única linha que foi sobrescrita 3 vezes.

### 3. Document — upload de currículo

**O que é:** o cenário de teste obrigatório #8 do enunciado (upload
válido/inválido). Um candidato manda um arquivo (currículo, carta,
certificado); o sistema confere se é um tipo de arquivo permitido (PDF,
Word) e se não é grande demais (limite de 5MB) ANTES de aceitar.

**Um bug real encontrado e corrigido no caminho:** quando um arquivo
excede o limite de tamanho, o framework (Nest) já pega esse erro
sozinho — só que ele devolvia um formato de erro diferente do resto do
projeto (um "413" cru, sem a estrutura padronizada que todo outro erro
do sistema tem). Corrigido pra devolver o mesmo formato consistente.
Isso, aliás, fecha PARCIALMENTE um problema que o Qwen já tinha
registrado há duas rodadas atrás — mas só a parte de upload; o caso
original dele (um campo de texto grande demais) continua em aberto.

### 4. Users (rotas novas) — gestão de usuários

**O que é:** completar o CRUD de usuários que já existia parcialmente
(desativar/reativar). Agora dá pra listar usuários, ver um específico,
trocar a empresa de um recrutador, e trocar o papel de alguém (de
CANDIDATE pra RECRUITER, etc.).

**A regra mais interessante:** um recrutador com vagas ainda em
andamento não pode simplesmente "virar candidato" — isso deixaria essas
vagas sem dono operacional. É a mesma ideia de não deixar uma empresa sem
nenhum administrador: às vezes, mudar uma coisa tem um efeito colateral
em outra parte do sistema que precisa ser considerado antes de permitir
a mudança.

### 5. RBAC Nível B — editar permissões em runtime

**O que é:** a parte mais avançada do projeto. Em vez de as permissões de
cada papel (CANDIDATE/RECRUITER/ADMIN) serem fixas no código, elas vivem
no banco de dados — e agora existe uma rota pra um ADMIN mudar, em tempo
real, o que cada papel pode fazer, sem precisar reimplantar a aplicação.

**O risco óbvio, e como foi travado:** o que acontece se alguém remover
a PRÓPRIA permissão que permite gerenciar permissões? Ninguém mais
conseguiria desfazer o erro — nem um administrador novo, porque a rota
que resolveria isso exige exatamente a permissão que acabou de sumir. É
como trancar a única cópia da chave-mestra dentro do cofre que ela abre.
A solução: antes de aplicar qualquer mudança, o sistema confere se pelo
menos UM papel no sistema inteiro ainda vai continuar com essa permissão
depois da mudança — se não, recusa.

**Uma prova interessante:** como as permissões de um usuário são
recalculadas do banco a cada requisição (decisão tomada lá na Fase 2,
pra outro motivo), uma mudança de permissão feita agora tem efeito
IMEDIATO em qualquer usuário logado — sem precisar ele sair e entrar de
novo. Testado na prática: dei uma permissão a um usuário, ele conseguiu
usar a rota; tirei a permissão SEM ele fazer login de novo; a próxima
tentativa dele já foi recusada.

## O que ficou registrado como pendência (decisão consciente, não esquecimento)

- Trocar a empresa de um recrutador deveria, idealmente, reatribuir as
  entrevistas futuras dele pra outra pessoa — não implementado (baixo
  risco, nada depende disso hoje).
- Revogar uma permissão de um papel hoje é "destrutivo" (apaga e recria);
  o ideal seria manter um histórico de quem revogou o quê e quando — isso
  exigiria mudar a estrutura do banco, fora do orçamento de tempo desta
  rodada.

## Como foi verificado

Build limpo, checagem de estilo sem avisos, 6 testes unitários e 131
testes end-to-end (contra um banco de dados real, não simulado), rodados
várias vezes seguidas pra garantir que não há resultado "sortudo". A
prova mais forte é a de concorrência real: duas contratações disputando
a última vaga de uma vez, repetidamente, sempre com o mesmo resultado
correto.

## Arquivos-fonte recomendados pra subir no NotebookLM

- `docs/fases/CONDICOES-ENTRADA-FASE2.md` (seção "Adendo Fase 4") — o
  registro completo de decisões desta etapa
- `src/applications/applications.service.ts` — a lógica de concorrência
  da contratação
- `src/roles/roles.service.ts` — a trava do "sem ninguém com
  role:manage"
- `test/applications.e2e-spec.ts` — o teste de concorrência real
- Este arquivo

## Prompt sugerido pro NotebookLM

> "Você é um tutor técnico ajudando um engenheiro a se preparar pra uma
> conversa de revisão técnica sobre 5 módulos que ele acabou de
> implementar sob pressão de tempo, sem ainda ter passado por auditoria
> externa. Baseado nas fontes: (1) resuma, pra cada um dos 5 módulos, o
> que ele faz e qual foi a decisão de design mais arriscada tomada nele;
> (2) explique com uma analogia do dia a dia por que a trava de
> concorrência da contratação (Application) e a trava de 'sem ninguém com
> role:manage' (RBAC) resolvem o mesmo tipo de problema geral, apesar de
> parecerem situações diferentes; (3) monte uma lista de 5 perguntas que
> um auditor cético (como o Qwen deste projeto) provavelmente faria sobre
> estes módulos, baseado no padrão de críticos que ele encontrou nos
> módulos anteriores (isolamento entre empresas, corridas de
> concorrência, vazamento de PII); (4) sinalize claramente que este
> conteúdo ainda não foi auditado, então trate qualquer afirmação de
   'está correto' como hipótese a confirmar, não fato estabelecido. Gere
> como um podcast em formato 'preparação pré-reunião', tom direto e
> prático."
