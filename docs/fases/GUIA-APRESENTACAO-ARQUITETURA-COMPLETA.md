# Guia de Apresentação — Arquitetura Completa

Documento pra estudar e treinar a apresentação. Foco no que o avaliador
pediu: não é sobre mostrar código, é sobre mostrar que você **entende**
o que foi construído — por quê, o que cada peça resolve, e onde cada
decisão se encaixa (obrigatório do enunciado, bônus, ou algo a mais que
você decidiu fazer). Cada seção tem: o que é, por que existe, e a
etiqueta de categoria.

Legenda: 🔴 **Obrigatório** (enunciado exige) · 🟡 **Bônus** (enunciado
sugere, "só depois do obrigatório") · 🟢 **Extra** (nem obrigatório nem
bônus listado — decisão própria).

Documentos complementares (não repetidos aqui): `docs/ENDPOINTS.md` (as
43 rotas, uma por uma), `docs/fases/GUIA-TESTES-SWAGGER-APRESENTACAO.md`
(roteiro de cliques no Swagger, teste por teste).

---

## 1. O pedido original, em uma frase

"Construa uma API de recrutamento com autenticação, autorização por
papel, upload de currículo, integração externa e concorrência tratada
corretamente — e prove tudo isso com testes reais." Isso é o enunciado
inteiro resumido. Todo o resto do projeto é resposta a essa frase.

**A analogia pra abrir a apresentação:** pensa numa plataforma tipo
LinkedIn Jobs ou Gupy — tem três tipos de pessoa (quem procura vaga,
quem contrata, quem administra a plataforma), cada vaga passa por um
ciclo de vida (rascunho → aberta → preenchida), e cada candidatura
também (inscrito → em análise → entrevista → contratado ou rejeitado).
O projeto inteiro é a modelagem desses dois ciclos de vida, mais quem
pode fazer o quê em cada etapa.

---

## 2. Arquitetura em camadas — a espinha dorsal

Toda requisição passa por 4 camadas, nesta ordem exata, antes de chegar
no seu código de negócio:

```
Requisição → ApiKeyGuard → JwtAuthGuard → PermissionsGuard → Interceptor → Controller → Service → Prisma → Postgres
                (1)             (2)              (3)             (4)
```

1. **`ApiKeyGuard`** 🔴 — "você é um cliente conhecido da API?" Exige o
   header `x-api-key` em **toda** rota, sem exceção (nem `/health`, nem
   `/auth/login`). Não identifica QUEM está usando, só QUE tipo de
   aplicação está usando (o front-end da plataforma, não um script
   qualquer). Analogia: é o crachá de visitante de um prédio — não diz
   quem você é, só que você foi autorizado a entrar no saguão.
2. **`JwtAuthGuard`** 🔴 — "você está logado, e como quem?" Lê o Bearer
   token, valida a assinatura, carrega o usuário do banco (com o papel e
   as permissões dele). Analogia: é o crachá pessoal, com foto — agora
   sabe quem é você.
3. **`PermissionsGuard`** 🔴 (mas o RBAC dinâmico é 🟢 **extra**) — "esse
   papel pode fazer ISSO especificamente?" Cada rota declara qual
   permissão exige (`@Permissions('job:create')`); o guard confere contra
   as permissões que o papel do usuário tem NO BANCO, não num enum fixo
   no código. Isso é a decisão mais "de engenharia" do projeto: em vez de
   `if (user.role === 'ADMIN')` espalhado pelo código, existe uma tabela
   `Role` → `Permission` que um ADMIN pode editar em runtime
   (`PUT /roles/:id/permissions`), sem precisar de deploy novo.
4. **`LoggingInterceptor`** 🔴 (item obrigatório "pelo menos um
   interceptor útil") — loga toda requisição que passou pelas 3 camadas
   acima, em JSON estruturado (`{"event":"http_request", "method",
   "route", "status", "durationMs", "userId"}`), sem nunca logar o corpo
   da requisição (protege senha/token de vazar em log).

**Por que essa ordem importa (ponto forte pra apresentação):** se o
`PermissionsGuard` rodasse antes do `JwtAuthGuard`, ele tentaria checar
permissão de um usuário que ainda nem foi identificado — um bug real
que já aconteceu numa rodada de auditoria deste projeto e foi corrigido.
A ORDEM dos guards é, ela mesma, uma regra de segurança.

**O que passa por cima de tudo isso, e por quê:** o
`GlobalExceptionFilter` — é o único ponto que enxerga uma rejeição de
guard (401/403) ou uma rota inexistente (404), porque essas exceções
nunca chegam a passar pelo interceptor (guards rodam antes dele). Sem
esse filtro, metade dos erros da API não deixaria rastro de log nenhum —
achado real de uma auditoria, corrigido.

---

## 3. Modelo de dados — as 7 entidades e por que cada relacionamento existe

🔴 Entidades mínimas exigidas: `User`, `Company`, `Job`,
`CandidateProfile`, `Application`, `Interview`, `Document`.

```
Company 1───N Job 1───N Application N───1 User (candidato)
                            │  N
                            │  1
                        Interview

User 1───1 CandidateProfile
User 1───N Document (owner)
Application N───1 Document (currículo anexado, opcional)
```

**Por que `CandidateProfile` é uma entidade separada de `User`, não
campos direto em `User`:** só CANDIDATE tem perfil de candidato (headline,
skills, CEP) — RECRUITER e ADMIN não. Separar evita colunas vazias pra
2/3 dos usuários e deixa claro que "ser candidato" é um papel com dados
próprios, não um atributo universal de usuário.

**Por que `Application` tem `resumeDocumentId` (opcional) em vez de
`Document` ter `applicationId`:** um documento pode existir ANTES de
qualquer candidatura (o candidato sobe o currículo uma vez, usa em várias
vagas). A seta vai de Application → Document, não o contrário.

**Por que existe `ApplicationStatusHistory`** 🟢 **extra** (o enunciado
só pede "histórico quando necessário", não especifica onde): cada
mudança de status de uma candidatura vira um registro, não só sobrescreve
um campo. Isso é o que permite calcular "tempo médio até contratação"
depois (ver §11) — sem histórico, essa métrica seria impossível.

**Entidades auxiliares do RBAC** 🟢 **extra** (o enunciado permite
"entidades associativas", não exige estas especificamente): `Role`,
`Permission`, `RolePermission` — a tabela de junção que faz o RBAC ser
dinâmico em vez de um enum `CANDIDATE | RECRUITER | ADMIN` fixo no
código.

**Enums e por que cada estado existe:**
- `JobStatus`: `DRAFT → OPEN → {PAUSED, FILLED, CLOSED, CANCELED}`. Uma
  vaga nasce rascunho (recrutador ainda editando), só fica visível
  publicamente em `OPEN`. `FILLED` só é alcançável quando
  `filledCount == vacancies` (regra de negócio, não manual).
- `ApplicationStatus`: `PENDING → UNDER_REVIEW → INTERVIEW → OFFERED →
  {HIRED, REJECTED}`, mais `WITHDRAWN` (o candidato desiste, de qualquer
  ponto). Cada transição é validada — não dá pra pular de `PENDING`
  direto pra `HIRED`.
- `InterviewStatus`: `SCHEDULED → {COMPLETED, CANCELED, NO_SHOW,
  RESCHEDULED}`. `RESCHEDULED` é especial: não edita a entrevista, CRIA
  uma nova (preserva o histórico de remarcações).

---

## 4. RBAC — papéis, permissões, e a regra de ouro

**A regra de ouro do enunciado, cite ela literalmente na apresentação:**
"usuários não podem manipular recursos de terceiros apenas alterando
IDs na requisição." Isso apareceu em TODO módulo como o mesmo padrão:
nunca confiar num ID que o cliente mandou pra decidir "de quem é isso" —
sempre derivar da identidade autenticada (`@CurrentUser()`) ou checar
posse antes de agir.

**Matriz de permissões** (28 chaves no catálogo, formato
`recurso:ação[:escopo]`):

| Papel | Nº permissões | O que faz, resumido |
|---|---|---|
| CANDIDATE | 8 | Vê vagas abertas, candidata-se, gerencia o próprio perfil/documentos |
| RECRUITER | 13 | Gerencia vagas e candidaturas da PRÓPRIA empresa |
| ADMIN | 24 | Tudo, exceto as 4 ações exclusivas de candidato |

**Por que RBAC dinâmico (banco) em vez de enum fixo** 🟢 **extra,
decisão de arquitetura consciente:** um enum (`if role === 'ADMIN'`)
exige deploy pra mudar quem pode fazer o quê. Com `Role`/`Permission`/
`RolePermission`, um ADMIN edita isso em runtime
(`PUT /roles/:id/permissions`) — e o efeito é IMEDIATO, sem novo login,
porque as permissões são recalculadas do banco a cada requisição. Esse é
o ponto mais forte pra demonstrar ao vivo: tirar uma permissão de
RECRUITER na hora e mostrar o `403` aparecer na próxima chamada.

**Anti-enumeração — o padrão que se repete em TODO módulo:** tentar
acessar recurso de outra empresa/outro usuário nunca dá `403` (que
confirmaria "existe, você só não pode ver"), sempre `404` ("não existe",
do ponto de vista de quem pediu). Isso é regra de negócio no *Service*,
não no guard — porque só o Service sabe de quem é o recurso.

---

## 5. Regras de negócio por módulo — o "porquê" de cada uma

### Companies 🔴
- CNPJ único (`409 cnpj_duplicado`).
- Soft-delete (`deactivate`/`reactivate`) — nunca `DELETE` físico, porque
  apagar uma empresa apagaria o histórico de quem trabalhou lá.
- CEP validado/enriquecido via integração externa no `create`/`update`.

### Jobs 🔴
- Máquina de estados (§3). `DELETE /jobs/:id` **não existe** de
  propósito — soft-delete via `status: CANCELED` preserva candidaturas/
  entrevistas/documentos vinculados a essa vaga.
- Vitrine pública (`GET /jobs`, sem login) só mostra `OPEN` de empresas
  ATIVAS — desativar uma empresa esconde as vagas dela da vitrine sem
  apagar nada.
- `vacancies`/`filledCount`: não dá pra reduzir `vacancies` abaixo do que
  já foi preenchido (`409`).

### CandidateProfile 🔴
- **Payload condicional** — o coração deste módulo. Um RECRUITER só vê
  o perfil completo (telefone, resumo, endereço) de um candidato que já
  avançou na candidatura (`UNDER_REVIEW`+); antes disso, só o mínimo pra
  triagem (nome, headline, skills). Analogia: é a diferença entre olhar
  o currículo resumido no LinkedIn e pedir pra ver o perfil completo —
  o segundo só libera depois que a empresa demonstrou interesse real.

### Applications 🔴 (o núcleo do negócio)
- **Candidatura duplicada proibida** — regra citada literalmente no
  enunciado. Garantida por constraint de banco (`@@unique`), não só por
  checagem em código (janela de corrida seria possível senão).
- **Vaga inativa não aceita candidatura** — outra regra literal do
  enunciado.
- **Contratação sob concorrência** 🔴 (Gate de concorrência, item que
  passou por várias rodadas de correção): duas pessoas tentando contratar
  o último candidato pra última vaga, ao mesmo tempo — só uma pode
  vencer, a outra recebe `409`, nunca as duas "vencem" e a vaga fica com
  mais gente contratada que vagas existentes. Testado com requisições
  simultâneas de verdade (`Promise.all`), não simulado.

### Interviews 🔴
- Só se agenda entrevista quando a candidatura JÁ está em `INTERVIEW`
  (não dá pra marcar entrevista de alguém ainda em triagem).
- `RESCHEDULED` cria um registro NOVO em vez de editar o antigo —
  contrato incomum, mas preserva "quantas vezes essa entrevista foi
  remarcada" como histórico real, não uma sobrescrita.

### Documents 🔴 (upload obrigatório)
- Valida presença, tipo (PDF/DOC/DOCX) e tamanho (5MB) — os três exigidos
  pelo enunciado.
- **Conectado a uma funcionalidade real** (exigência do enunciado): o
  documento vira o currículo de uma candidatura via `resumeDocumentId`,
  não é upload solto sem propósito.
- Regra de escopo mais fina do projeto: um RECRUITER só vê um documento
  se ele foi **explicitamente anexado** (`resumeDocumentId`) a uma
  candidatura da empresa dele, com status já em avaliação — não "qualquer
  documento desse candidato". Sem essa regra, um documento pessoal nunca
  enviado a ninguém vazaria pra qualquer recrutador com quem o candidato
  já tivesse falado.

### Users/Roles 🟢 (extra — RBAC Nível B, além do pedido original)
- `deactivate`/`reactivate`, trocar empresa/papel de um usuário — tudo
  ADMIN only, com travas de "não desativa a própria conta" e "não remove
  o último ADMIN ativo do sistema" (testado sob concorrência real: 8
  admins temporários, tentativas simultâneas de se autodesativarem
  mutuamente, e o sistema nunca fica sem nenhum ADMIN).

---

## 6. Integração externa (CEP) 🔴

`HttpService` consumindo o ViaCEP real (não mock), usado em `Company` e
`CandidateProfile`. **O contrato que faz isso robusto:** três resultados
possíveis, tratados diferente:
- CEP válido → enriquece endereço.
- CEP que o provedor confirma **não existir** → rejeita a operação
  inteira (`400`) — é erro de quem digitou.
- Falha de REDE/timeout → não bloqueia, salva sem endereço com um aviso
  (`addressWarning`) — é falha do provedor, não do usuário.
  
Achado real de auditoria: a versão original tratava "CEP inválido" e
"rede fora do ar" da mesma forma — o que permitia, numa atualização,
salvar um CEP novo com o ENDEREÇO ANTIGO (par inconsistente). Corrigido
discriminando os dois casos.

**Bônus (extra) derivado disso:** `GET /cep/:cep` 🟢 — expõe essa mesma
lógica como consulta isolada, pro frontend fazer "digite o CEP,
autopreenche o formulário" antes de o usuário terminar de preencher o
resto.

---

## 7. Segurança — o que o enunciado pediu, item por item

| Exigência do enunciado | Como foi resolvido |
|---|---|
| JWT secret por ambiente | `.env` por ambiente, aplicação recusa subir se o valor for o placeholder de exemplo |
| `.env` fora do Git | Confirmado (`.env`/`.env.test` nunca versionados — achado de segurança corrigido nesta reta final: `.env.test` chegou a vazar credencial real, já corrigido e rotacionado) |
| Helmet habilitado | `src/main.ts` |
| Compression habilitado | `src/main.ts` |
| Rotas privadas protegidas | As 3 camadas de guard (§2) |
| Autorização testada | Todo módulo tem teste e2e de "sem permissão → 403" |
| Logs sem segredos | Interceptor nunca loga corpo da requisição |
| Senhas nunca retornadas | `omit` global do Prisma — nenhuma query precisa lembrar de excluir `password` manualmente |

**CORS** 🟢 **extra** (não exigido — o enunciado não previa um frontend
navegador consumindo a API): adicionado na reta final, porque sem isso
nenhum frontend rodando numa porta diferente conseguiria nem completar
uma requisição — o navegador bloquearia antes.

---

## 8. Docker 🟡 bônus

**O que cada peça faz, em uma frase cada:**
- `Dockerfile` (multi-stage: `deps` → `build` → `runtime`): a imagem
  final não carrega ferramentas de build nem código-fonte TypeScript, só
  o JS compilado + `node_modules` de produção — imagem menor, superfície
  de ataque menor.
- `docker/compose.dev.yml`: orquestra 3 serviços — `postgres` (banco,
  sem porta exposta ao host, só rede interna), `migrate` (roda as
  migrations e sai, não fica de pé), `api` (a aplicação, porta `3001`).
- Usuário não-root dentro do container (`node`, não `root`) — se alguém
  comprometer o processo, não ganha root na máquina host.
- Volumes persistentes: dados do Postgres e uploads sobrevivem a um
  `docker compose down`/`up` (não perdem tudo a cada restart).

---

## 9. Observabilidade (Grafana/Loki/Promtail) 🟡 bônus

**A ideia em uma frase:** a aplicação só sabe **imprimir** log; alguém
precisa **coletar**, **guardar** e **mostrar** esse log. É isso que os
três fazem, cada um uma etapa:

- **Promtail** — "coletor": lê os logs de todo container Docker
  (inclusive o da API), limpa formatação (remove código de cor ANSI que
  quebraria a leitura), e envia pro Loki.
- **Loki** — "banco de dados de log": guarda tudo, indexado por label
  (`container="recrutamento-api"`), pra consulta rápida depois.
- **Grafana** — "vitrine": os dashboards que leem do Loki e desenham
  gráfico. 6 painéis: logs em tempo real, volume por minuto, requisições
  por método HTTP (pizza), por status HTTP (pizza), total de requisições,
  e latência média — todos já consultando o formato JSON estruturado
  (`| json` no LogQL, não mais regex em texto solto).

**Importante pra demonstrar isso ao vivo — não é `http://localhost:3000`:**
o Promtail só coleta log de container Docker. A API nativa do dia a dia
(porta `3000`) não passa por ele. Pra qualquer clique no Swagger aparecer
no Grafana em tempo real, use a instância **Dockerizada**, em
`http://localhost:3001/docs` (ver README §4.9) — não a `3000`. Testar na
`3000` e esperar ver algo no Grafana é o erro mais fácil de cometer numa
apresentação ao vivo (acontece de forma silenciosa: nenhum erro aparece,
o painel só fica vazio).

**Ponto pra mencionar na apresentação (mostra maturidade):** o formato do
log da aplicação mudou de texto livre pra JSON estruturado
(`{"event":"http_request","method","route","status","durationMs"}`)
especificamente pra esses dashboards conseguirem extrair campo por campo
em vez de depender de regex frágil em cima de texto solto — decisão de
formato pensada pra quem vai CONSUMIR o log, não só pra quem vai LER na
tela.

---

## 10. Testes — a estratégia, não só o número

🔴 Os 10 cenários obrigatórios do enunciado, cobertos. 🟡 163 testes no
total (muito além do mínimo) — mas o número importa menos que a
**disciplina**:

- **Banco real, não mock** — todo teste roda contra um Postgres de
  verdade (`recrutamento_test`), recriado do zero antes da suíte. Só
  UMA coisa é mockada no projeto inteiro: a chamada HTTP do ViaCEP, num
  único teste unitário, especificamente pra provocar o cenário de "rede
  fora do ar" de forma determinística (não dá pra derrubar a internet de
  propósito num teste).
- **Concorrência real, não simulada** — os testes de "duas contratações
  simultâneas" e "dois admins se desativando ao mesmo tempo" usam
  `Promise.all` disparando requisições de verdade em paralelo contra a
  API rodando, não uma função chamada duas vezes em sequência.
- **Regra de teste de concorrência, aprendida "no erro":** nunca assertar
  "exatamente um sucesso" ou "o motivo X aconteceu" — sempre assertar o
  ESTADO FINAL no banco (nunca ultrapassou o limite) e o CONJUNTO de
  desfechos aceitos, porque concorrência real pode resolver por mais de
  um caminho legítimo. Essa lição apareceu (e foi corrigida) três vezes
  ao longo do projeto até virar regra escrita.

---

## 11. Bônus e indicadores de negócio 🟡

`GET /companies/:id/stats` — vagas por status, funil de candidaturas,
taxa de conversão, e **tempo médio até contratação calculado de
verdade** a partir do histórico (`ApplicationStatusHistory`), não
estimado. RECRUITER só vê a própria empresa (dado de contratação é
informação competitiva). Isso é diferente da observabilidade do §9:
aquela é métrica de INFRAESTRUTURA (como a API está se comportando),
esta é métrica de NEGÓCIO (como a empresa está performando no
recrutamento).

---

## 12. Checklist — tudo num quadro só

| Categoria | Itens |
|---|---|
| 🔴 Obrigatório | Stack, 7 entidades, autenticação, RBAC, upload, integração externa, interceptor, tratamento 400-409, build limpo, README, 10/10 cenários de teste |
| 🟡 Bônus | Paginação, filtros, ordenação configurável, Swagger, seed, testes automatizados, Docker, indicadores de negócio |
| 🟢 Extra | RBAC dinâmico via banco, `GET /cep/:cep` isolado, histórico de status, validação de ambiente no boot, CORS, filtro global de exceções do Prisma |

---

## 13. Roteiro cronológico sugerido pra apresentação

Uma sequência que conta a história na ordem certa — do requisito ao
resultado — sem precisar mostrar uma linha de código:

1. **Abra com o pedido original** (§1) — "isso é uma plataforma de
   recrutamento com 3 papéis e regras de concorrência."
2. **Mostre a arquitetura em camadas** (§2) — desenhe ou aponte o
   diagrama dos 4 guards/interceptor, explique a ORDEM.
3. **Abra o Swagger** — use a instância Docker (`http://localhost:3001/docs`,
   ver README §4.9), não a nativa (`3000`): assim os passos 4-8 batem no
   MESMO ambiente que o Grafana do passo 8 está observando (evita mostrar
   uma vaga/candidatura criada num banco e o Grafana vazio porque estava
   olhando o outro). Mostre os 43 endpoints agrupados por tag em
   português, aponte o botão Authorize funcionando.
4. **Demonstre o RBAC dinâmico ao vivo** (§4) — tire uma permissão de
   RECRUITER via `PUT /roles/:id/permissions`, mostre o `403` aparecer
   na próxima chamada sem reiniciar nada. É o momento mais forte da
   apresentação.
5. **Percorra o modelo de dados** (§3) — mostre o diagrama de
   relacionamentos, explique por que `CandidateProfile` é separado, por
   que `ApplicationStatusHistory` existe.
6. **Mostre uma regra de negócio em ação** — candidatura duplicada
   (`409`), ou o payload condicional de perfil (reduzido → completo).
7. **Mostre anti-enumeração** — tente acessar recurso de outra empresa,
   aponte o `404` (não `403`) e explique por quê.
8. **Abra o Grafana** (`http://localhost:3002`, §9) — logs em tempo real
   enquanto você clica no MESMO Swagger do passo 3 (`:3001`), mostre a
   linha JSON aparecendo.
9. **Feche com o checklist** (§12) — obrigatório 100%, bônus 100%,
   mais os extras — e o porquê de cada extra ter valido a pena.

Pratique contando isso como uma HISTÓRIA (requisito → decisão → prova),
não como uma lista de features. É isso que demonstra entendimento, não
memorização.
