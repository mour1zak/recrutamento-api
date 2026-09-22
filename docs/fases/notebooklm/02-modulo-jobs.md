# Etapa 2: Módulo Jobs (vagas) — CRUD, visibilidade condicional e transições de estado

> Pacote-fonte pra colar no NotebookLM e gerar um podcast/relatório de
> entendimento desta etapa.

## O que foi construído, em linguagem simples

Depois de Companies, construímos **Jobs** (vagas de emprego) — o
segundo módulo de domínio, e o mais complexo até agora porque introduz
três ideias novas que nenhum módulo anterior tinha: uma rota que
**qualquer pessoa pode ver sem estar logada** (a vitrine pública de
vagas), uma regra de **isolamento entre empresas** ("recrutador só
opera vagas da própria empresa" — regra obrigatória do enunciado), e
uma **máquina de estados** (uma vaga nasce rascunho, precisa ser aberta
pra virar pública, e só pode ser marcada como "preenchida" quando
realmente estiver).

## As decisões desta etapa, e o porquê

**1. Uma vaga tem "dono" — a empresa dela.** Quando um recrutador cria
uma vaga, ela automaticamente pertence à empresa dele — ele não escolhe.
Só o ADMIN (que não pertence a empresa nenhuma) precisa dizer
explicitamente para qual empresa é a vaga. Se um recrutador tentar criar
uma vaga pra outra empresa (não a dele), a resposta é "não encontrado"
(`404`), não "sem permissão" (`403`) — mesmo princípio de segurança já
usado no resto do projeto: nunca confirmar que o recurso de outra pessoa
existe.

**2. Nem toda vaga é visível pra todo mundo.** Uma vaga recém-criada
começa como `DRAFT` (rascunho) — só quem é da empresa dona dela consegue
ver. Quando o recrutador muda o status pra `OPEN` (aberta), a vaga passa
a aparecer pra **qualquer pessoa**, mesmo sem estar logada — é a
"vitrine" pública de vagas de um site de recrutamento de verdade. Depois
de fechada (`FILLED`, `CLOSED` ou `CANCELED`), ela volta a ser só visível
pra empresa dona (histórico interno).

**3. Uma vaga não pode "andar pra trás" de qualquer jeito.** Existe uma
ordem certa de estados: rascunho → aberta → (pausada ou preenchida ou
cancelada). Pular etapas (tentar ir direto de "rascunho" pra
"preenchida", por exemplo) é rejeitado. E marcar uma vaga como
"preenchida" só é aceito se ela realmente tiver o número de vagas
completo — tentar isso antes da hora também é rejeitado.

**4. Não existe "apagar vaga".** Assim como empresa e usuário, uma vaga
nunca é fisicamente removida — ela é "cancelada" (um status, não uma
exclusão). Isso preserva o histórico de quem se candidatou, entrevistas
marcadas, documentos enviados — tudo isso ficaria órfão se a vaga
simplesmente sumisse do banco.

**5. Paginação virou padrão do projeto a partir daqui.** Toda lista de
resultados (a vitrine pública, "minhas vagas") agora aceita `?page` e
`?limit` — decisão tomada agora pra não ter que voltar em cada módulo
futuro (candidaturas, entrevistas, documentos) pra adicionar isso depois.

## Como validamos

A prova mais importante desta etapa foi de **isolamento entre
empresas**: criamos duas empresas de mentira, cada uma com seu próprio
recrutador, e provamos que o recrutador da empresa A nunca consegue ver,
editar ou mudar o status de uma vaga da empresa B — sempre recebe "não
encontrado", nunca uma pista de que a vaga existe. Esse é exatamente um
dos 10 cenários de teste que o enunciado da avaliação exige (acesso a
recurso de terceiro).

Também teve teste de execução real (não só automatizado): criamos uma
vaga de verdade contra o servidor rodando, confirmamos que ela não
aparecia na lista pública enquanto `DRAFT`, mudamos pra `OPEN`, e
confirmamos que passou a aparecer.

45 testes automatizados no total (17 novos deste módulo), todos verdes,
mais a checagem manual contra o servidor real.

## Arquivos-fonte recomendados pra subir no NotebookLM

- `src/jobs/jobs.service.ts` — toda a lógica de negócio (a parte mais
  densa desta etapa)
- `src/jobs/jobs.controller.ts` — as 6 rotas
- `test/jobs.e2e-spec.ts` — os cenários testados, especialmente o
  isolamento entre empresas
- `src/common/dto/pagination-query.dto.ts` — o padrão de paginação novo
- Este arquivo

## Prompt sugerido pro NotebookLM

> "Você é um tutor técnico explicando este projeto pra um engenheiro que
> é o arquiteto responsável pela entrega, quer entender a fundo antes de
> aprovar, e vai usar isso pra revisar com um auditor de qualidade
> (Qwen) depois. Baseado nas fontes: (1) explique a máquina de estados de
> uma vaga (`DRAFT/OPEN/PAUSED/FILLED/CLOSED/CANCELED`) como um fluxograma
> em palavras, dizendo por que cada transição bloqueada existe; (2)
> explique, com um exemplo concreto de dois recrutadores de empresas
> diferentes, como o sistema garante que um nunca vê a vaga do outro, e
> por que a resposta é '404' e não '403'; (3) aponte pelo menos 3
> perguntas que um auditor cético faria sobre este módulo antes de
> aprovar (ex.: o que acontece se dois recrutadores tentarem mudar o
> status da mesma vaga ao mesmo tempo?). Gere como um podcast de
> conversa entre um host cético (fazendo as perguntas de auditoria) e um
> host didático (explicando o raciocínio por trás de cada decisão)."
