# Parecer Qwen — Revisão Definitiva (QA Lead / DevSecOps)

**Projeto:** `recrutamento-api` · **Commit auditado:** `2da212e` (main) · **Data:** 2026-09-24
**Método:** clone limpo do repositório remoto em diretório novo, README seguido literalmente do §4.1 ao §6, tudo verificado por **execução real** (não leitura de comentário), conforme pedido.

**Ambiente do teste (independente do ambiente de desenvolvimento de vocês):** Debian 12 (Linux x86-64), Node v22.23.3, npm 12.0.2, PostgreSQL 15.19 local, **sem Docker** (stack de observabilidade verificada por leitura estática — sinalizado onde isso limita a verificação).

**Veredito resumido:** o produto está sólido — o clone limpo funciona do zero, **164 testes verdes (9 unit + 155 e2e)**, segurança real verificada ao vivo (guard timing-safe, validação, omit, CEP, CORS, env validation). **Mas não é ainda o "sinal verde final"**: há **6 achados que um avaliador rigoroso pega** (números contraditórios no README em 3 lugares, status HTTP errado no log em rotas traduzidas pelo filtro — que afeta exatamente a demo do Grafana, comentário no `main.ts` que contradiz o produto, duas afirmações do README empiricamente falsas, `tsc --noEmit` full-repo que não passa, e roteiro de apresentação que vai mostrar Grafana vazio ao vivo). Todos baratos de corrigir (~1–2h, mostly docs). Detalhes abaixo.

---

## Pergunta 3 (peça específica) — clone limpo independente

Refiz o fluxo inteiro, sem reaproveitar nada de sessões anteriores:

| Passo do README | Resultado |
|---|---|
| §4.2 `CREATE ROLE`/`CREATE DATABASE` (dev+test) | ✅ executado literal, funciona |
| §4.3 `cp .env.example .env` + segredos via `openssl rand` | ✅ |
| §4.3 `cp .env.test.example .env.test` + segredos próprios | ✅ |
| §4.4 `npm install` | ⚠️ **no meu sandbox** morreu com `ENOMEM` no spawn do preinstall do prisma (cgroup de 1GB) — limitação do sandbox, não do projeto. Contornei com `--ignore-scripts` + postinstall manual de `@prisma/engines`/`esbuild`. Numa máquina normal o `allowScripts` do package.json cobre a permissão de scripts (npm 12). Não conto como achado do projeto. |
| §4.4 `npx prisma migrate dev` | ✅ 4 migrations aplicadas |
| §4.4 `npx prisma generate` | ✅ — e **confirmei empiricamente o achado documentado**: após `migrate dev`, `src/generated/` NÃO existe; sem o `generate` explícito o `start:dev` quebraria. O passo do README é realmente necessário. |
| §4.4 `npx prisma db seed` | ✅ 28 permissões, 3 papéis, 3 usuários |
| §4.5 `npm run start:dev` | ✅ sobe em :3000 |
| §4.6 `npm run build` + `start:prod` | ✅ build limpo, prod sobe, `/health` ok |
| §4.7 `npm run db:reset:test` | ✅ (proteção "banco precisa conter 'test'" presente e correta no script) |
| §4.7 `npm test` | ✅ **9/9** |
| §4.7 `npm run test:e2e` | ✅ **155/155 em 14 arquivos** |
| §4.8 `/docs` + Authorize | ✅ — ver detalhe abaixo |
| §6 exemplos curl 1–8 + os 5 erros | ✅ todos reproduzem o documentado (inclusive as mensagens literais de 400/401/403/404/409) |

**Autorize com x-api-key gerada do zero:** gerei `API_KEY` nova com `openssl rand -hex 24` (nunca usada antes), confirmei os security schemes do `/docs-json` (`apiKey` in header `x-api-key` + `http bearer`) e exercitei **exatamente o contrato que o botão Authorize produz**: login seed → `accessToken` → rota protegida `GET /users`/`GET /roles` 200; chave errada → 401 "API key ausente ou inválida."; sem JWT → 401. (Clique literal no botão não é possível em sandbox headless — o contrato de headers que ele injeta foi validado ponta a ponta, que é o que o botão faz.)

**Divergências entre README e realidade encontradas no walkthrough** (detalhadas nos achados F1/F4/F5):
1. Contagem de testes: real = **164 (9 + 155)**; banner e §2.2 dizem **163 (154 e2e)**; §4.7 diz **158 (149 e2e)** e lista 13 arquivos omitindo `test/company-stats.e2e-spec.ts` (4 testes). Sua mensagem (9/9 + 155/155) é a única que bate com o real.
2. §4.8 diz "Lista os **42** endpoints em 11 tags" — real: **43** operações / 11 tags (banner, §2.2 e tabela §5 dizem 43, corretos).
3. §4.1 afirma em negrito que `DATABASE_URL` é obrigatório "para qualquer comando do Prisma, inclusive `prisma generate`" — **falso**: movi o `.env`, dessetei a variável, `npx prisma generate` rodou limpo (exit 0) graças ao fallback placeholder do `prisma.config.ts`, cujo comentário diz exatamente o oposto do README.
4. §2.4 diz que as 4 high do `npm audit` "são devDependencies (não entram no build de produção)" — **impreciso**: `prisma` é *peerDependency opcional* de `@prisma/client@7`, então `npm ci --omit=dev` (linha 18 do Dockerfile) **instala** prisma+mysql2+deepmerge-ts na imagem de produção; `npm audit --omit=dev` reporta as 4 high no grafo prod. Ver F5 (fix de 1 flag, validado).

Fora isso, **a ordem dos passos funciona exatamente como escrita** — inclusive a sequência `migrate dev → generate → db seed`, e o aviso do §4.7 sobre banco sujo (`db:reset:test` antes do e2e) procede.

---

## Checklist item a item

### 1. Arquivo solto / código morto — ✅ ok
Build do grafo de imports de todos os 82 `.ts` de `src/` (excluindo `src/generated`): **78/78 arquivos de produto são importados**; os 4 "órfãos" são os `.spec.ts` (entry points do vitest via glob — não são código morto). `prisma/seed.ts` referenciado pelo `prisma.config.ts`; `scripts/db-reset-test.ts` referenciado pelo `package.json`. Nenhum `.ts` solto.

### 2. Import não usado — ✅ ok (segunda verificação independente feita)
- `npm run lint` (oxlint --type-aware): rodei — **0 warnings / 0 errors, 96 arquivos, 111 regras** (resposta à sua dúvida sobre cobertura do `.oxlintrc.json`: defaults do oxlint + `no-floating-promises: error` + `no-explicit-any: off`; são 111 regras ativas, não só as 2 do config).
- Independente: `tsc --noEmit` com **`noUnusedLocals` + `noUnusedParameters`** ligados, cobrindo `src` + `test` + `scripts` + `prisma` + `prisma.config.ts`: **zero TS6133/TS6192/TS6196** — nenhum import/variável/parâmetro não usado em lugar nenhum.
- Ressalva: o `tsc` full-repo **não é limpo por outros motivos** — ver item 3.

### 3. Linha com sintaxe errada / arquivo fora do grafo de build — ❌ achado (F6)
Exatamente a categoria que vocês pediram para sondar. `tsconfig.build.json` exclui `test/` e `**/*spec.ts`; vitest não type-checka; oxlint não resolve tipagem de módulo. Resultado: `tsc --noEmit -p tsconfig.json` (o tsconfig do projeto, sem flags extras) **falha com 15 erros em 14 arquivos de teste** — todos latentes (nenhum afeta runtime; os 164 testes passam):
1. **13× TS2307** — `import { App } from 'supertest/types'` em todos os e2e-specs: sob `moduleResolution: nodenext`, subpath de pacote sem `exports` **precisa de extensão**. `App` é usado só como tipo (`INestApplication<App>`), o esbuild elimina o import no runtime → passa despercebido. **Fix validado por probe**: `'supertest/types.js'` resolve limpo com o tsconfig do próprio projeto (ideal: `import type`).
2. **TS2322** `src/roles/roles.service.spec.ts:41` — `const error: ConflictException = await ....catch(e => e as ConflictException)`: o tipo é a união `ConflictException | <retorno de sucesso>`. Fix: tipar como `unknown` (o `toBeInstanceOf` seguinte já faz o narrowing de fato).
3. **TS2322** `test/candidate-profile.e2e-spec.ts:277` — `for (const status of ['INTERVIEW','OFFERED','HIRED'])` infere `string` vs. union do enum Prisma. Fix: `as const` no array.

Recomendação: corrigir os 3 pontos **e** adicionar um script `typecheck` (`tsc --noEmit -p tsconfig.json`) como gate — senão a classe "arquivo fora do grafo de build com erro" continua invisível para todas as ferramentas do projeto. Se um avaliador rodar `npx tsc --noEmit`, vê 15 erros hoje.

### 4. Fluxo de arquitetura (ordem dos guards + logging sem lacuna/duplicação) — ✅ ok, com ❌ achado de valor (F2)
- **Ordem dos guards**: `ApiKeyGuard → JwtAuthGuard → PermissionsGuard` em `app.module.ts` — correta e verificada ao vivo (chave errada + JWT válido → 401 de API key; chave ok + sem JWT → 401; JWT ok sem permissão → 403 `permission_denied`). `ApiKeyGuard` usa `sha256 + timingSafeEqual` (constant-time, sem leak de tamanho) e é fail-closed se `API_KEY` não configurada. `PermissionsGuard` com semântica AND (`every`) e as duas rotas "OU" decididas no Service conforme documentado.
- **Cobertura/duplicação do log** — verificado empiricamente, 1 linha por requisição em **todos** os caminhos: sucesso (LOG), erro de negócio HttpException (LOG, status correto), rejeição de guard (WARN), rota inexistente (WARN), 403 de permissão (WARN). O dedup por `HTTP_LOG_WRITTEN` **não regrediu**. ✅
- **MAS — F2 (achado novo, demonstrado ao vivo):** em erros cujo status final é determinado **pelo GlobalExceptionFilter** (não por uma HttpException lançada), o interceptor loga o status **antes** da tradução — e o marker suprime a linha do filtro. Medidas reais:
  - CNPJ duplicado (P2002 borbulhando, caminho documentado em `companies.service.ts`): cliente recebeu **409** `cnpj_duplicado`; log registrou **`"status":201`**.
  - Upload >5MB (cenário obrigatório #8): cliente recebeu **400** `arquivo_excede_tamanho_maximo`; log registrou **`"status":413`**.
  - Por leitura de código (não consegui disparar 500 inesperado via API): erro não-HttpException sem `.status` → loga `response.statusCode` pré-filtro (200/201) — ou seja, **um 500 real apareceria no Grafana como sucesso**.
  - Impacto: o painel "Requisições por status HTTP" do dashboard e qualquer contagem de erro via Loki ficam errados exatamente nas rotas traduzidas pelo filtro. Numa demo ao vivo com upload estourando tamanho (cenário #8 do enunciado), o dashboard mostra 413 — status que a API nunca retorna.
  - **Fix sugerido (pequeno):** inverter a responsabilidade — interceptor loga **só sucesso** (e marca só em sucesso); **todo** erro é logado pelo filtro, que conhece o status final (`respond()` e `fallbackStatus` do `super.catch()`). Mantém exatamente 1 linha por requisição, com status sempre verdadeiro. Se quiserem `durationMs` na linha de erro, o interceptor grava o `start` no request e o filtro calcula. O comentário do tap-error ("response.statusCode já reflete o status final que o filtro escreveu") é factualmente errado — o tap roda antes do filtro; foi isso que mascarou o bug.

### 5. README com informação errada — ❌ achados (F1, F4, F5, F3; tabela em si ✅)
- **Tabela §5 (43 endpoints): ✅ 43/43 idênticos** — extraí as rotas dos 11 controllers e comparei programaticamente com a tabela do README **e** com o `/docs-json` ao vivo: mesmo método, mesma URL, mesma permission key (32 rotas com `@Permissions`, 2 "sem @Permissions" de propósito, 4 `@Public`, health). Valores de `PERMISSIONS` batem com as keys da tabela. Respostas: exercitei ao vivo health, cep (200/400×2/502), auth (201/400/409/200/401/204), companies (201/409-P2002/stats 200), jobs (201/409 job_not_open/400 invalid_status_transition/vitrine pública sem `createdById`/`filledCount` e com `company{id,name}`), applications (201/409 duplicada/200 status/403 interview por CANDIDATE), documents (201/400 mime/400 tamanho/me/download) — tudo conforme a tabela; o restante é coberto pelos 155 e2e verdes.
- **`docs/ENDPOINTS.md`: ✅** cobre as 43 (nota: `GET /roles` e `GET /roles/:id` dividem um heading — conteúdo correto, só derrubou meu primeiro diff automático).
- **F1 — números de teste contraditórios em 3 lugares** (ver tabela na Pergunta 3): banner "163 (154 e2e)", §2.2 "163 (154)", §4.7 "158 (149)" + lista de arquivos sem `company-stats.e2e-spec.ts`, §4.8 "42 endpoints". Real medido: **164 (9+155), 43 endpoints, 14 arquivos e2e**. `docs/fases/AUDITORIA-FINAL-AUTOAPLICADA.md` repete 163/154 (doc histórico — decidam se atualizam; o README é obrigatório). É o tipo de inconsistência que avaliador rigoroso encontra em 2 minutos de leitura cruzada, e o próprio README se anuncia como "contrato de honestidade".
- **F4 — §4.1 `DATABASE_URL`/`prisma generate`**: afirmação em negrito empiricamente falsa (teste na Pergunta 3, item 3). Corrigir o parágrafo para refletir o `prisma.config.ts`: a variável é necessária para comandos que **conectam** (`migrate`, `db seed`); `generate` funciona sem ela (fallback placeholder). Ironicamente o config cita um achado de revisão anterior que o README não absorveu.
- **F5 — §2.4 npm audit**: contagem confere (4 high: mysql2×2 advisories + deepmerge-ts + prisma agregado), mas a justificativa "são devDependencies, não entram no build de produção" **não procede**: `@prisma/client@7` declara `prisma` como peerDependency **opcional** → `npm ci --omit=dev` instala tudo isso na imagem runtime. Risco prático ~zero (código nunca importado em runtime — adapter é `pg`; deepmerge-ts só executa no CLI), mas a afirmação está errada e scanner de avaliador mostra 4 high "prod". **Fix validado:** `RUN npm ci --omit=dev --omit=optional` no estágio runtime do Dockerfile → `npm audit --omit=dev --omit=optional` = **0 vulnerabilidades** (verificado). Ajustar o texto da §2.4 ao mecanismo real.
- **F3 — comentário obsoleto no `main.ts`** (acima do `configureSwagger`): descreve `/docs` como **protegido por middleware x-api-key** ("a proteção é um middleware dedicado exigindo a mesma x-api-key") — decisão **revertida** na rodada 15; comportamento real, `swagger.config.ts`, README §4.8 e `docs.e2e-spec.ts` dizem "público de propósito". O comentário ainda cita "41 rotas/24 permission keys" (hoje 43 rotas; catálogo 28 / ADMIN 24). Sem impacto de comportamento, mas é um comentário que **mente sobre segurança** para quem lê o bootstrap — corrigir antes da apresentação (custa 5 linhas).

### 6. Swagger com dado sensível exposto — ✅ ok (com nota de consistência F7)
- Varredura completa de **todos** os `example`/`default` do spec ao vivo (`/docs-json`): 16 exemplos, todos inofensivos — emails `@example.com` (domínio reservado), CNPJ `12.345.678/0001-90` (placeholder canônico), CEP `01310-100` (Av. Paulista, público), ids numéricos, datas. **Nenhuma** credencial, nome de tabela/coluna/constraint, ou algoritmo de hash. `grep -rn "example:" src --include="*.dto.ts"` confere com o spec.
- `password` mascarado `********` nos dois DTOs ✅ + trava de regressão real (`test/docs.e2e-spec.ts` afirma que `/docs-json` não contém os 4 valores do seed — passando).
- Bônus verificado: mensagens de erro nunca expõem nome cru de constraint (`CONSTRAINT_LABELS` no filtro), e o `reason` de CNPJ é genérico.
- **F7 (consistência, não vulnerabilidade):** o valor recém-mascarado no Swagger (`SenhaForte@123`) **continua publicado** no README §6 exemplo 1 (linha 607) e em 3 requests da coleção Postman (`docs/postman/recrutamento-api.postman_collection.json`); o environment Postman traz `seedPassword=Senha@123` (equivalente às credenciais de teste que o §4.8 já publica de propósito — esse ok). Se a política é "artefato publicado não sugere padrão de senha", README/Postman a violam; se a política vale só para artefatos da aplicação viva (Swagger), documentem a distinção. Uso em fixtures de teste (`test/*.e2e-spec.ts`) é legítimo e não mexeria.

### 7. Rotas com validações corretas — ✅ ok
- `ValidationPipe` global com `whitelist: true, forbidNonWhitelisted: true, transform: true` no `main.ts` **e verificado ao vivo**: campo desconhecido → 400 "property campoSurpresa should not exist"; email inválido + senha curta → 400 com o array de mensagens **idêntico** ao exemplo do README §6.
- DTOs × schema: colunas Prisma são `text` sem limite (Postgres), então todo `@MaxLength` de DTO é estritamente mais restritivo que o banco — não existe combinação que estoure coluna. `@IsEnum` nos 4 enums reais (`ApplicationStatus`, `InterviewStatus`, `JobStatus`, `DocumentType`), `@Matches` para CEP (`^\d{5}-?\d{3}$`) e CNPJ (14 dígitos com/sem máscara), `@Min(1)` em `vacancies` coerente com a regra FILLED/HIRED, paginação com `@Type(() => Number)` + `@Max(100)` no limit + `sortOrder @IsIn(['asc','desc'])` (só direção, como documentado), `skills @ArrayMaxSize(30)`.
- Nit (não-achado, nada documenta o contrário): não há validação cruzada `salaryMin <= salaryMax` — vaga com min>max é aceita. Se quiserem fechar, um `@ValidateIf`/checagem no service; senão, ignorar.

### 8. API externa (CepService/ViaCEP) — ✅ ok, ao vivo e sem mock
- `GET /cep/01310-100` → 200 `{street:"Avenida Paulista",city:"São Paulo",state:"SP"}` (ViaCEP real, também funciona sem máscara).
- `GET /cep/99999-999` → **400** `cep_nao_encontrado`; `GET /cep/abcdef` → **400** `cep_formato_invalido`.
- **`unavailable` testado de verdade**: subi uma segunda instância com `EXTERNAL_CEP_API_URL` apontado para IP não-roteável e timeout 1500ms → `GET /cep` retornou **502** `servico_cep_indisponivel` em ~1.5s, e `POST /companies` **não bloqueou**: 201 com endereço `null` + `addressWarning` — exatamente o contrato do README §2.1/§2.3.
- Contrato discriminado `ok/invalid/unavailable` implementado como documentado; os 3 unit tests (HttpService mockado) + 4 e2e (ViaCEP real) verdes.

### 9. Dados sensíveis nunca retornados — ✅ ok
- `omit` global (`user.password`, `refreshToken.tokenHash`, `document.path`) ativo no `PrismaService`.
- `grep` de overrides: **exatamente os 2 lugares declarados** — `users.service.ts:70` (`omit:{password:false}` no `findByEmailForLogin`; o hash nunca sai: o `login()` re-busca via `findAuthenticatedById` com `authUserSelect` e responde `toPublicUser`) e `documents.service.ts:70` (`omit:{path:false}` para o `res.download`, que é stream — nenhum JSON com `path`). Nenhum `select` com campo sensível em lugar nenhum.
- Empírico: respostas de register/login/refresh (`user{id,name,email,role}` + tokens), `GET /users` (lista sem `password`), upload/list/download de documentos (sem `path`; `filename` é o UUID interno, `originalName` só no Content-Disposition) — nada sensível em nenhuma resposta exercitada. Refresh token opaco armazenado como hash; rotação atômica via `updateMany` com `revokedAt: null` no WHERE (conforme documentado).

### 10. CORS — ✅ ok (com recomendação defensiva F9)
- Verificado ao vivo: sem `CORS_ORIGIN`, origem arbitrária (`http://evil.example`) recebe `Access-Control-Allow-Origin` refletido; **e mesmo assim** toda rota segue exigindo `x-api-key`/JWT (401 sem eles, independentemente do `Origin`) — confirmado que CORS **não** substitui a camada de autorização. Helmet ativo (CSP, HSTS, X-Frame-Options, nosniff — headers conferidos). Preflight 204 com os headers pedidos.
- **F9 (baixa, defensiva):** `credentials: true` combinado com origem refletida é o padrão que auditoria CORS sempre marca. Hoje é inexplorável — a auth é por headers customizados (o browser não anexa nada automaticamente; não há cookies). Mas se um dia o frontend guardar token em cookie, vira vetor de account takeover. Sugestão de 1 linha: `credentials: true` **somente** quando `CORS_ORIGIN` estiver definida; com origem livre, `false`. Não bloqueia nada.

---

## Pergunta 1 — o `example` mascarado (`********`) é suficiente?

**✅ Sim, é suficiente — não recomendo omitir o example.**

- `********` não sugere classe de caractere, palavra, capitalização ou padrão real — não há informação explorável. A única "dica" embutida é o comprimento (8 asteriscos = minLength 8 do RegisterDto), e isso é **inócuo de propósito**: o schema Swagger já publica `minLength: 8` e a description diz "mínimo 8 caracteres" — política de tamanho de senha é documentação intencional da API, não vazamento. (No `LoginDto`, que deliberadamente só exige `@MinLength(1)` para não ecoar política no fluxo de login, os 8 asteriscos são neutros: ninguém valida login por tamanho de máscara.)
- Omitir o example produz segurança **idêntica** (Swagger mostra só `type: string`) com UX ligeiramente pior para o avaliador no "Try it out" (campo vazio vs. placeholder auto-explicativo). É preferência estética, não ganho.
- O que realmente importava — credencial real do seed publicada — está corrigido **e travado por teste de regressão** (`docs.e2e-spec.ts`), que é a defesa certa.
- **Ressalva de consistência (F7):** o mesmo valor que vocês mascararam no Swagger (`SenhaForte@123`) segue no curl do README §6 (linha 607) e em 3 bodies da coleção Postman. Não é vulnerabilidade (nenhuma conta do seed usa esse valor; o register é aberto por natureza), mas é inconsistente com a política que motivou o mascaramento. Ou mascaram/trocam lá também, ou registram uma frase de política ("artefatos da aplicação viva são mascarados; fixtures de repo usam valor fictício fixo") para a decisão não parecer descuido.

---

## Pergunta 2 — arquitetura de observabilidade (Docker/Grafana/Promtail/Loki)

### 2a. A arquitetura é aceitável como está?
**Sim para fins de avaliação — não mexam na infraestrutura agora.** Cobrir só o container é o comportamento natural de um stack Promtail-com-docker_sd: o agente coleta logs de containers, ponto. Isso é defensável e honesto. **O que não está aceitável é o roteiro de demo atual (F8):**
- `GUIA-APRESENTACAO-ARQUITETURA-COMPLETA.md` passo 8: "Abra o Grafana — logs em tempo real **enquanto você clica no Swagger**" — sem dizer **qual** Swagger. O `GUIA-TESTES-SWAGGER-APRESENTACAO.md` (linha 23) manda abrir `http://localhost:3000/docs` — a instância **nativa**. Seguido ao pé da letra, o painel fica **vazio ao vivo na frente do avaliador** — exatamente o tipo de falha que parece bug de produto.
- **Regra de demo a adotar:** Grafana ao vivo ⇒ todo tráfego contra a API Dockerizada (`http://localhost:3001/docs`). O caminho mais robusto é fazer **a demonstração inteira** contra o stack Docker (Swagger :3001 + Grafana :3002) e deixar a nativa :3000 para o dia a dia. Atenção ao efeito colateral: são **dois ambientes independentes** (bancos distintos, seeds distintos, `API_KEY` do `docker/.env` ≠ `.env` nativo) — se os passos 3–7 do roteiro (RBAC dinâmico, 409s) forem feitos na nativa e o 8 no Docker, os dados não serão os mesmos. Unificar no Docker elimina essa armadilha.
- Lembrem também do pré-requisito VirtualBox: com rede NAT, portas 3001/3002 precisam de port-forwarding pro host Windows (ou usar rede bridge + IP da VM). Vale um ensaio geral na VM antes do dia.

### 2b. Existe jeito mais simples de unificar?
**Não — e a intuição de vocês está certa: a simplificação real é mudar o alvo, não o encanamento.** As alternativas possíveis são todas ≥ o que já foi rejeitado:
- Promtail nativo no Windows + Loki exposto pra fora da VM + log de processo em arquivo: é exatamente o caminho que vocês avaliaram como complexo. Concordo.
- Push HTTP direto do processo Node pro Loki push API: exigiria expor a porta 3100 da VM + código/script de transporte no Windows — mesma complexidade, mais superfície.
- OTLP/agentes alternativos: idem, agente no Windows de qualquer forma.
- **A solução de custo zero já existe no repo:** o `compose.sh` sobe a API Dockerizada com Swagger próprio em `:3001`, no mesmo host do Grafana. Apontar o navegador pra lá **é** a unificação. Não escrevam código novo para isso.

### 2c. Precisa estar documentado no README?
**Sim — explicitamente, e não é só a ressalva que falta.** Hoje o README **não tem nenhuma instrução de como rodar o stack Docker/observabilidade**: não menciona `docker/.env.example → docker/.env`, o `compose.sh`, as portas (API 3001, Grafana 3002), as credenciais do Grafana, nem como reproduzir o bônus que a §2.2 declara "Concluída e verificada por execução". O filtro `container="recrutamento-api"` no compose.obs.yml torna o comportamento *deduzível* para quem lê YAML — mas o README é a porta de entrada do avaliador, e o modo de falha (dashboard vazio) é indistinguível de bug. Sugestão: criar **§4.9 "Docker + Observabilidade"** com ~15 linhas:
1. `cp docker/.env.example docker/.env` e preencher segredos;
2. `./docker/compose.sh up -d --build`;
3. API em `http://localhost:3001` (Swagger em `/docs`), Grafana em `http://localhost:3002`;
4. **Ressalva em negrito:** "O Grafana reflete **apenas** o tráfego contra a instância Docker — a API nativa (`:3000`, dev do dia a dia) não possui coletor. Para demonstrações ao vivo, use sempre `:3001`.";
5. (Opcional) nota de que é um ambiente independente do dev nativo (banco/seed/API_KEY próprios).

Aproveitem e atualizem a §9 do guia de apresentação: os painéis de método/status/latência que estão "(em ajuste na reta final)" **já existem** no `api-logs.json` v4 — texto desatualizado. E vejam o F2 antes de demostrar o painel "por status HTTP": hoje ele mostraria 201/413 em rotas que respondem 409/400.

---

## Achados novos consolidados (fora do checklist)

| # | Severidade | Achado | Fix sugerido |
|---|---|---|---|
| F1 | **Média** (credibilidade do doc) | Números de teste/endpoint contraditórios: banner & §2.2 "163/154", §4.7 "158/149"+lista sem `company-stats`, §4.8 "42 endpoints". Real: **164 (9+155), 14 arquivos, 43 endpoints** | Atualizar os 4 lugares (+ decidir sobre o doc histórico) |
| F2 | **Média** (observabilidade/demo) | Interceptor loga status pré-filtro: P2002→409 logado como **201**; upload>5MB→400 logado como **413**; 500 inesperado logaria como 200/201. Demonstrado ao vivo | Mover log de erro para o `GlobalExceptionFilter` (status final); interceptor loga só sucesso |
| F3 | Baixa | Comentário do `main.ts` afirma que `/docs` é protegido por x-api-key (revertido na rodada 15) + números obsoletos | Reescrever o comentário apontando para a decisão final |
| F4 | Baixa | README §4.1: "DATABASE_URL obrigatório inclusive pro generate" — falso (testado sem a variável; config tem fallback) | Alinhar o texto ao `prisma.config.ts` |
| F5 | Baixa-média | README §2.4: 4 high "não entram no build de produção" — entram sim (peer opcional do `@prisma/client` → `npm ci --omit=dev` instala) | Dockerfile: `npm ci --omit=dev --omit=optional` (**validado: audit prod = 0**); corrigir o texto |
| F6 | **Média** (se avaliador rodar `tsc`) | 15 erros de tipo latentes em 14 arquivos de teste (13× `supertest/types` sem extensão sob nodenext; 2× TS2322) — invisíveis a build/vitest/oxlint | `'supertest/types.js'` + 2 fixes de 1 linha + script `typecheck` como gate |
| F7 | Baixa (consistência) | `SenhaForte@123` remanescente no README §6 (l.607) e em 3 bodies do Postman | Mascarar/trocar lá também, OU documentar a distinção de política |
| F8 | **Média** (demo ao vivo) | Roteiro de apresentação + guia Swagger apontam para :3000 no passo do Grafana → dashboard vazio ao vivo; README sem nenhuma instrução do stack Docker | Corrigir passo 8 p/ :3001; criar §4.9; ensaiar na VM |
| F9 | Baixa (defensiva) | CORS `credentials: true` com origem refletida (inexplorável hoje — auth por headers, sem cookies) | `credentials` só com `CORS_ORIGIN` definida |

**Nits (não pedem ação):** DeprecationWarning do `pg` na saída do e2e (`client.query()` concorrente — vem do adapter/raw em gate-fase3/company-stats; monitorar na subida do pg@9); aviso do vitest sobre `vite-tsconfig-paths` (nativo agora); fallback `admin/admin` do Grafana no compose (o `docker/.env.example` já orienta trocar — manter o `.env` preenchido na VM).

---

## Verificações adicionais que fiz por conta (todas ✅)

- **Boot seguro:** app **recusa subir** com os placeholders do `.env.example` (testado: exit 1, mensagem clara) e também com os segredos de teste vazados no histórico (blocklist em `env.validation.ts` para dev/prod); `JWT_SECRET == API_KEY` bloqueado; seed recusa `NODE_ENV=production` (código verificado).
- **Higiene Git:** `.env`, `.env.test`, `docker/.env`, `uploads/`, `.claude/` todos ignorados (`git check-ignore` verificado um a um); `git ls-files` sem nenhum segredo; `.env.test` ausente do HEAD (removido em `a942178`); `JWT_REFRESH_SECRET` só existe em docs históricos.
- **Fluxos de negócio ao vivo (além dos e2e):** vaga nasce DRAFT; candidatura em DRAFT → 409 `job_not_open`; DRAFT→OPEN ok; OPEN→DRAFT → 400 `invalid_status_transition`; candidatura → PENDING; duplicada → 409 `candidatura_duplicada`; avanço → 200; stats agregando real; CANDIDATE em `interview:*` → 403 (design intencional, não reportado como bug); vitrine pública sem `createdById`/`filledCount` e com `company{id,name}`.
- **Logs:** JSON estruturado sem ANSI no payload (o strip do prefixo fica no pipeline do Promtail — configuração conferida); níveis LOG/WARN conforme a política documentada.
- **Dashboard:** queries do `api-logs.json` v4 coerentes com o formato JSON atual (`| json`, `unwrap durationMs`); datasource/provisioning corretos (leitura estática — sem Docker no sandbox, o "confirmado contra o Loki real" de vocês fica aceito como declarado pela sessão de infraestrutura).

---

## Conclusão

**Estado do produto:** excelente para apresentação — o essencial (segurança, testes, contrato, reprodutibilidade do clone) está verificado e de pé. **Sinal verde final: ainda não.** Recomendo fechar antes da apresentação, nesta ordem: **F1** (números — 15 min), **F8** (roteiro/§4.9 — 30 min), **F2** (status no log — 30–45 min), **F6** (tipos + gate — 30 min), **F3/F4/F5** (docs/Dockerfile — 15 min). F7/F9/nits ficam a critério. Depois disso, na minha avaliação, podem apresentar com confiança — inclusive o demo do Grafana, desde que contra o :3001 e com o F2 corrigido para os painéis de status não mentirem.

*— Qwen (QA Lead / DevSecOps), revisão por execução independente, 2026-09-24.*
