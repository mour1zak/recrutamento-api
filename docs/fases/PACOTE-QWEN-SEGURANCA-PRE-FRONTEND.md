# Pacote para revisão — Qwen (QA Lead & DevSecOps) — Revisão de Segurança Final (pré-frontend)

Cole este documento inteiro na conversa com o Qwen.

---

Você é o **QA Lead / DevSecOps Specialist** do projeto `recrutamento-api`.
O pacote de auditoria final anterior (`PACOTE-QWEN-AUDITORIA-FINAL.md`)
não teve resposta. Desde então, fizemos uma rodada adicional de
verificação — desta vez testando o próprio processo de onboarding
(clone limpo do zero, seguindo o README ao pé da letra) em vez de só o
código — e encontramos e corrigimos achados reais, incluindo um de
segurança genuíno. Este pacote pede uma revisão final focada
especificamente nisso, porque a partir de agora um **frontend real** vai
consumir esta API — não é mais só uma avaliação isolada, é a superfície
que outro sistema vai depender.

## O que mudou desde o último pacote

### 1. `.env.test` tinha credencial real commitada (corrigido)

`.env.test` estava versionado no Git com valores reais, não placeholders
— incluindo a **mesma senha do Postgres local usada no `.env` de dev**
(não uma senha dedicada só de teste, como o comentário do código
alegava). Ou seja: uma credencial de infraestrutura real ficou pública no
repositório desde o commit que a introduziu.

**Corrigido:**
- `.env.test` removido do Git; só `.env.test.example` (placeholder,
  mesmo padrão do `.env.example`) fica versionado.
- A senha do Postgres local foi **rotacionada** — o valor antigo, que
  permanece no histórico do Git (não reescrevemos o histórico —
  decisão explícita, ver "Pergunta 1" abaixo), não autentica mais nada.
- `JWT_SECRET`/`API_KEY` de teste também foram regenerados.
- `.gitignore` corrigido pra nunca mais versionar `.env.test`.

### 2. README quebrado pra quem clona do zero (corrigido)

Testamos clonando o repositório remoto de verdade (não o diretório de
trabalho local) e seguindo os passos de instalação na ordem exata do
documento. Três problemas reais:

- `npx prisma migrate dev` **não gera o Prisma Client** nesta versão/modo
  (Prisma 7.10.0, driver adapter) — o README afirmava que gerava.
  Seguindo a ordem sugerida (`migrate dev` → `start:dev`), a API quebrava
  com `ERR_MODULE_NOT_FOUND` antes mesmo de subir. Corrigido: `npx prisma
  generate` explícito adicionado como passo obrigatório.
- Nenhuma instrução pra semear o banco de **dev** (só o de teste tinha
  isso documentado) — as credenciais de teste citadas no guia do Swagger
  davam `401` num clone novo. Corrigido: `npx prisma db seed` adicionado
  ao fluxo de instalação.
- `JWT_REFRESH_SECRET`: o README mandava gerar essa variável, mas ela
  nunca existiu (nem em `.env.example`, nem validada em código) —
  resquício de um design antigo (o refresh token é opaco, não JWT
  assinado). Removida do README e do placeholder morto que sobrava em
  `env.validation.ts`.

Depois das correções: clone limpo → install → migrate → generate → seed
→ build/start → login funcionando → **163 testes verdes** (9 unitários +
154 e2e), reproduzido de ponta a ponta, não assumido.

### 3. Log HTTP duplicado (corrigido, achado comparando com outro projeto)

Todo erro de negócio (`400`/`404`/`409` lançado por um Service) gerava
**duas linhas de log** pra mesma requisição: uma em `LOG` (do
`LoggingInterceptor`, que vê a exceção porque ela passa pelo pipeline do
handler) e outra em `WARN` (do `GlobalExceptionFilter`, que loga de
propósito os casos que o interceptor NUNCA vê — rejeição de guard, rota
inexistente). O filtro não sabia que o interceptor já tinha logado.

**Corrigido:** o interceptor marca a requisição (`Symbol`, não string,
pra não colidir com nada) depois de logar; o filtro pula a própria linha
se a marca já estiver presente. `WARN` agora é reservado de verdade só
pro tráfego que o interceptor nunca viu (401/403 de guard, 404 de rota) —
o sinal de segurança que motivou a mudança original continua intacto,
sem o ruído da duplicação. Log também passou de string livre pra JSON
estruturado (`{"event":"http_request","method","route","status",
"durationMs","userId"?}`), mais fácil de indexar no Grafana/Loki já
configurado.

## Perguntas específicas

1. **Sobre não reescrever o histórico do Git:** a senha do Postgres
   exposta só é alcançável de `localhost` (nunca foi exposta em rede), e
   já foi rotacionada — o valor antigo no histórico é uma string morta.
   Reescrever histórico exigiria force-push + qualquer fork/clone
   existente reclonar. Essa avaliação de custo-benefício está certa, ou
   você recomendaria reescrever mesmo assim?
2. **Tem mais algum segredo/credencial commitado** em qualquer lugar do
   repositório (não só `.env.test`) que não pegamos? Pedimos
   especificamente que você grep por padrões de senha/chave/token em todo
   o histórico, não só no estado atual — o achado do `.env.test` só
   apareceu porque testamos o clone do zero, o que sugere que pode haver
   mais coisa que uma leitura do estado atual não pegaria.
3. **Superfície pro frontend:** agora que um cliente real vai consumir
   isso, os contratos de erro (`reason` machine-readable), CORS (não
   configurado — a API não define `Access-Control-Allow-Origin` em lugar
   nenhum, o que bloquearia um frontend rodando em outra origem/porta no
   navegador) e a documentação Swagger pública são suficientes, ou falta
   algo específico pra esse caso de uso que uma API "só testada via
   Postman/Swagger" não precisaria?
4. **CORS especificamente:** confirma que isso precisa ser adicionado
   antes do frontend rodar num navegador (mesmo em `localhost:3000` vs.
   `localhost:5173`/outra porta do Vite/Next, são origens diferentes pro
   navegador), e se sim, qual configuração você recomendaria (origem
   fixa via env var, lista de origens permitidas, ou `credentials: true`
   já que o projeto usa Bearer token, não cookie)?

## Verificação

`npm run build` limpo · `npm run lint` 0 avisos · `npm test` 9/9 ·
`npm run test:e2e` 154/154 · reproduzido num clone limpo do repositório
remoto (não só no diretório de trabalho) · senha do Postgres local
rotacionada e testada (dev e teste, os dois ambientes reconectam com o
valor novo) · log duplicado confirmado e corrigido com teste ao vivo
(antes: 2 linhas por erro de negócio; depois: 1).
