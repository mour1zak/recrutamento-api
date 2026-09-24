# Pacote para revisão — DeepSeek — Lacuna de permissão: CANDIDATE não vê a própria entrevista

Cole este documento inteiro na conversa com o DeepSeek.

---

Você é o **Estrategista / Planejador de Infraestrutura** do projeto de
Plataforma de Recrutamento. Você definiu a matriz de permissões original
(`PARECER-DEEPSEEK-FASE1.md`, 28 keys, CANDIDATE=8/RECRUITER=13/ADMIN=24)
e o mapa de endpoints (`PARECER-DEEPSEEK-FASE2-ENDPOINTS.md`, seção 5,
Entrevistas). Este pacote é sobre uma lacuna encontrada nessa matriz
enquanto preparávamos um roteiro de testes manuais no Swagger — não é uma
falha de implementação, é uma pergunta de volta pra quem desenhou a regra.

## O achado, confirmado ao vivo (não é suposição)

Nenhuma das 8 permissões do CANDIDATE inclui `interview:*`. Testamos
contra o servidor rodando: login como candidato, `GET /interviews/:id`
de uma entrevista da própria candidatura → **`403 permission_denied`**.

Isso significa que, hoje, **o candidato não tem NENHUMA rota da API pra
ver a própria entrevista agendada** — nem `GET /applications/:applicationId/interviews`
nem `GET /interviews/:id`. As três rotas de leitura de `Interview` exigem
`interview:read`, key que só RECRUITER e ADMIN têm.

## Por que achamos que isso pode estar errado

O candidato já enxerga o `status` da própria candidatura
(`application:read:own`) — sabe quando ela chega em `INTERVIEW`. Mas
`scheduledAt`, `location`, `meetingLink` e `interviewerId` vivem só na
entidade `Interview`, que ele não consegue ler. Ou seja: ele sabe que TEM
uma entrevista marcada, mas não sabe QUANDO nem ONDE, por nenhuma rota.

Isso quebra a simetria que o resto do catálogo segue: toda entidade que
pertence ao candidato tem uma variante `:own` — `application:read:own`,
`application:withdraw:own`, `candidate-profile:update:own`,
`document:read:own`. `Interview` é a única exceção, e nada em
`PARECER-DEEPSEEK-FASE1.md`/`FASE2-ENDPOINTS.md` registra isso como
decisão consciente (ex.: "a comunicação da entrevista é feita por fora do
sistema, por email/telefone, de propósito") — parece só ter faltado
mapear esse ângulo quando o catálogo foi fechado.

## O que pedimos que você decida

1. **Isso foi uma omissão, ou uma decisão consciente** (ex.: a
   plataforma assume que a comunicação de entrevista acontece por um
   canal fora da API, e mostrar `Interview` pro candidato não faz parte
   do escopo do produto)? Se foi decisão consciente, só precisamos
   registrar isso explicitamente no README/`FASE-1-MODELAGEM.md` e
   seguimos sem mudar nada.
2. **Se for lacuna**: você concorda com adicionar uma key nova
   `interview:read:own`, concedida só ao CANDIDATE, seguindo o mesmo
   padrão de escopo que `application:read:own`/`document:read:own` já
   usam (ADMIN=25 keys nesse caso, RECRUITER continua 13, CANDIDATE=9)?
3. **Se sim ao item 2**: o candidato deveria ver a entrevista em QUALQUER
   status (`SCHEDULED`/`COMPLETED`/`CANCELED`/`RESCHEDULED`/`NO_SHOW`),
   ou só enquanto `SCHEDULED` (ex.: histórico de entrevistas passadas não
   é relevante pra ele depois de encerrada)? E ele deveria ver o
   `feedback` que o recrutador escreve (`Interview.feedback`), ou isso é
   informação interna só entre RECRUITER/ADMIN?

## Caminho técnico se a resposta for "sim, é lacuna, adiciona a key"

Já mapeado, não implementado (aguardando seu veredito):
- Adicionar `INTERVIEW_READ_OWN: 'interview:read:own'` ao catálogo em
  `permissions.constants.ts`, incluída em `CANDIDATE_PERMISSIONS`.
- Trocar `@Permissions(PERMISSIONS.INTERVIEW_READ)` das duas rotas de
  leitura (`GET /applications/:applicationId/interviews` e
  `GET /interviews/:id`) pelo mesmo padrão OU já usado em
  `ApplicationsController.findOne`/`DocumentsController.findOne`: sem
  `@Permissions()` no controller, checagem manual no Service de
  `interview:read` (recrutador/admin) OU `interview:read:own` (o
  candidato é o dono da `Application` associada), com o mesmo 403
  genérico se nenhuma das duas.
- `POST`/`PATCH` (`create`/`update`) continuam exigindo só
  `interview:read`/`interview:create`/`interview:update` — o candidato
  nunca cria/edita, só lê o que já foi agendado.
- Novos testes e2e cobrindo: candidato dono lendo a própria entrevista
  (200), candidato de OUTRA candidatura tentando ler (404, anti-
  enumeração), e a suíte completa (151 testes) reverificada sem
  regressão.

## Verificação atual (sem essa mudança ainda aplicada)

`npm run build` limpo · `npm run lint` 0 avisos · `npm test` 9/9 ·
`npm run test:e2e` 142/142. Nada foi alterado no código ainda — este
pacote é só a pergunta de decisão de produto antes de mexer na matriz de
permissões.
