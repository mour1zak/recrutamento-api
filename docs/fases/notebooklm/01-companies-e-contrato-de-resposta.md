# Etapa 1 (pós-Fase 2): Módulo Companies + ajuste do contrato de resposta

> Pacote-fonte pra colar no NotebookLM (Fontes → Adicionar → colar texto,
> ou subir este arquivo junto com os `.ts` listados na seção final) e
> gerar um podcast/relatório de entendimento desta etapa.

## O que foi construído, em linguagem simples

Depois de fechar a Fase 2 (Auth/RBAC, aprovada pelo Qwen na Rodada 7),
começamos o primeiro módulo de domínio de verdade: **Companies**
(empresas). Até aqui, tudo que existia era "quem pode entrar" (login) e
"quem pode gerenciar usuários" — Companies é a primeira peça do negócio
em si: cadastrar, ler, atualizar e desativar/reativar empresas.

Junto com isso veio a primeira **integração externa obrigatória** do
enunciado: quando alguém cadastra uma empresa, o sistema consulta o CEP
informado num serviço de terceiros (ViaCEP) e preenche rua/cidade/estado
sozinho — sem exigir que a pessoa digite isso na mão. Se essa consulta
falhar por qualquer motivo (CEP não existe, serviço fora do ar, demorou
demais), a empresa é criada do mesmo jeito, só sem esses dados
preenchidos — a falha de um serviço de terceiro nunca pode travar a
operação principal.

## As três decisões desta etapa, e o porquê de cada uma

**1. Onde colocar a lógica de CEP.** Em vez de escrever a consulta
dentro do próprio módulo de Companies, ela virou um serviço comum
(`CepService`), porque o perfil de candidato (`CandidateProfile`, ainda
não construído) também vai ter endereço e vai precisar da mesma lógica.
Construir pensando no próximo módulo que vai reusar isso, em vez de
duplicar depois.

**2. Erros com "motivo" explícito.** Toda vez que a API responde
"não deu certo", ela pode fazer isso de duas formas: só com uma frase
("Já existe um registro com o mesmo valor em: CNPJ.") ou com a frase
**mais** um código curto e fixo que um programa consegue ler
(`reason: "cnpj_duplicado"`). A partir do Companies, adotamos os dois
juntos — pensando num futuro frontend, que pode usar o `reason` pra
decidir o que mostrar na tela sem precisar interpretar texto em
português. As rotas de login/usuários que já existiam antes continuam
só com a frase, porque já passaram pela auditoria do Qwen desse jeito e
mudar agora reabriria um assunto já fechado sem necessidade.

**3. O que a API devolve depois de "desativar"/"reativar" algo.**
Esse foi o ponto mais discutido. Existem duas formas comuns de responder
a uma ação desse tipo:
   - **"Deu certo, e não tenho mais nada a dizer"** (código HTTP `204`,
     sem corpo nenhum na resposta) — foi como o projeto tinha feito
     desde a Fase 2, pro `deactivate`/`reactivate` de usuário.
   - **"Deu certo, e aqui está como o registro ficou"** (código `200`,
     com o objeto atualizado no corpo) — é mais informativo, e evita que
     quem está chamando a API precise fazer uma segunda pergunta
     ("e agora, como ficou?") logo em seguida.

   Como o próximo passo do projeto é construir um frontend, decidimos
   trocar para a segunda opção nos dois módulos (Users e Companies),
   pra manter consistência: uma tela que desativa uma empresa (ou um
   usuário) já recebe de volta a confirmação com o estado novo, sem
   precisar buscar de novo.

## Como validamos que nada quebrou

Essa mudança não mexeu em nenhuma regra de segurança ou de negócio já
auditada (a trava de "não pode ficar sem nenhum administrador ativo"
continua exatamente igual) — só no formato da resposta de sucesso. Pra
confirmar isso, três coisas foram refeitas:

1. Os testes automatizados que checavam "resposta vazia" foram
   atualizados pra checar "resposta com os dados certos".
2. A suíte inteira (28 testes end-to-end + 4 testes unitários) rodou de
   novo, incluindo o teste que provoca 8 administradores tentando se
   desativar ao mesmo tempo — continua nunca dando erro de servidor.
3. Testamos manualmente contra o servidor rodando de verdade (não só os
   testes automatizados), tanto pra usuário quanto pra empresa,
   confirmando na tela o `isActive: false` depois de desativar e
   `isActive: true` depois de reativar.

## Arquivos-fonte recomendados pra subir no NotebookLM

- `src/companies/companies.service.ts` — a lógica de negócio do módulo novo
- `src/companies/companies.controller.ts` — as rotas
- `src/common/cep/cep.service.ts` — a integração externa
- `src/users/users.service.ts` — pra comparar o "antes/depois" do
  `deactivate`/`reactivate`
- `docs/fases/PARECER-DEEPSEEK-FASE2-ENDPOINTS.md` — o desenho original
  de todas as rotas que ainda faltam construir
- Este arquivo

## Prompt sugerido pro NotebookLM

> "Você é um tutor técnico explicando este projeto pra um engenheiro que
> é o arquiteto responsável pela entrega, mas quer entender a fundo cada
> decisão antes de aprovar. Baseado nas fontes: (1) explique em
> linguagem simples o que o módulo Companies faz e por que a integração
> de CEP nunca pode travar a criação da empresa; (2) explique a diferença
> entre devolver `204` sem corpo e `200` com o recurso atualizado numa
> API REST, com um exemplo prático de cada; (3) liste os pontos que,
> se eu fosse revisar como um auditor de segurança/qualidade (tipo o
> Qwen deste projeto), eu deveria questionar ou pedir mais prova antes de
> aprovar. Gere isso como um podcast de conversa entre dois hosts, um
> mais cético (fazendo as perguntas de auditoria) e um mais didático
> (explicando o raciocínio)."
