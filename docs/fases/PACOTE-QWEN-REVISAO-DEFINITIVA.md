# Pacote para revisão — Qwen (QA Lead & DevSecOps) — Revisão Definitiva

Cole este documento inteiro na conversa com o Qwen.

---

Você é o **QA Lead / DevSecOps Specialist** do projeto `recrutamento-api`.
Este é o pacote que antecede a apresentação pro avaliador — depois desta
rodada, o próximo passo é o teste manual final (clonar o repositório numa
máquina/arquitetura diferente e seguir o README do zero) e a
apresentação em si. **Nada pode passar despercebido.** Pedimos que você
seja tão rigoroso quanto possível, incluindo os itens "óbvios" que uma
leitura rápida pularia.

Dois pacotes anteriores (`PACOTE-QWEN-AUDITORIA-FINAL.md` e
`PACOTE-QWEN-SEGURANCA-PRE-FRONTEND.md`) não tiveram resposta — as
correções deles foram feitas de forma autoaplicada e estão documentadas
em `docs/fases/AUDITORIA-FINAL-AUTOAPLICADA.md`. Este pacote consolida
tudo que ficou pendente de revisão externa até agora, mais achados novos.

## O que mudou desde os pacotes anteriores (resumo, não repita a leitura deles se não quiser)

1. `.env.test` tinha credencial real commitada (mesma senha do Postgres
   de dev) — removido do Git, senha rotacionada, `.env.test.example`
   criado.
2. README quebrado num clone limpo: `npx prisma generate` ausente (o
   `migrate dev` não gera o client nesta versão/modo), seed da base de
   dev nunca documentado, variável `JWT_REFRESH_SECRET` fantasma. Os três
   corrigidos e revalidados clonando o repositório remoto do zero.
3. Log HTTP duplicado (todo erro de negócio gerava 2 linhas — uma do
   interceptor, outra do filtro) — corrigido com uma marca na requisição;
   log também virou JSON estruturado.
4. CORS não estava configurado — adicionado (`CORS_ORIGIN` opcional,
   aceita qualquer origem sem a variável).
5. `.claude/launch.json` (config de ferramenta de IA, sem uso pra quem
   clona) removido do Git.
6. **Achado novo, ainda não revisado por ninguém de fora:** o `example`
   de `LoginDto.password`/`RegisterDto.password` no Swagger mostrava um
   valor **falso mas com cara de senha real** (`SenhaForte@123`) — mesmo
   não sendo uma credencial válida, sugeria um padrão/formato de senha.
   Mascarado pra `********` nos dois lugares.

## Pergunta 1 — o exemplo de senha mascarado é suficiente?

Verifique se `********` como `example` resolve o problema (não sugere
formato/padrão nenhum), ou se você recomendaria omitir o `example`
inteiramente nesses dois campos (Swagger, sem `example`, mostra só o
`type: string`).

## Pergunta 2 — arquitetura de observabilidade (Docker/Grafana/Promtail/Loki)

Contexto: Docker, Loki, Promtail e Grafana rodam **dentro de uma VM
Linux local** (VirtualBox), num compose separado do dev nativo. A API
que a gente testa manualmente no Swagger, no dia a dia, roda **nativa no
Windows** (`npm run start:dev`, fora do Docker) — não existe hoje nenhum
agente rodando no Windows pra levar esses logs até o Loki da VM. Ou seja:
**só o tráfego que bate na API dentro do Docker (porta `3001` do
container, dentro da VM) aparece no Grafana; o tráfego contra a API
nativa do Windows (porta `3000`) nunca chega lá.**

Perguntas específicas:
1. Essa arquitetura (observabilidade só cobrindo o container Docker, sem
   agente no Windows) é aceitável como está, ou isso deveria ser resolvido
   antes da apresentação — por exemplo, testando SEMPRE contra a API
   Dockerizada quando for mostrar o Grafana ao vivo?
2. Tem algum jeito mais simples de unificar isso que não pensamos (sem
   precisar instalar um Promtail nativo no Windows, expor a porta do Loki
   pra fora da VM, e redirecionar log de processo nativo pra arquivo —
   isso já foi avaliado como mais complexo que só apontar o navegador pra
   porta do Docker)?
3. Pra fins de nota/avaliação: essa arquitetura precisa estar documentada
   explicitamente no README (deixando claro que "Grafana só reflete
   tráfego contra a instância Docker"), ou isso já é implícito o
   suficiente pra quem lê `docker/compose.obs.yml`?

## Pergunta 3 — peça específica: repita o teste de clone limpo, de forma independente

Já fizemos isso uma vez (clonamos o repositório remoto pra um diretório
novo, seguimos o README do início ao fim, achamos e corrigimos 3 bugs).
Pedimos que você faça o mesmo, de forma **independente** — sem usar
nenhum arquivo/diretório que já exista de sessões anteriores:

1. Clone `https://github.com/mour1zak/recrutamento-api.git` num diretório
   novo.
2. Siga o README **literalmente**, passo a passo, sem pular nada e sem
   usar conhecimento prévio do projeto — pré-requisitos, banco, `.env`,
   `.env.test`, instalação, migrations, build, testes, Swagger.
3. Anote qualquer ponto onde a instrução não bate com o que realmente
   acontece (comando que falha, passo que falta, ordem que não funciona).
4. Rode a suíte completa (`npm test` + `npm run test:e2e`) e confirme o
   número de testes verdes bate com o que o README declara.
5. Abra o `/docs` e confirme que o botão Authorize funciona com uma
   `x-api-key` gerada do zero (não reaproveitada de nenhum lugar).

## Checklist de revisão — cada item, marcado explicitamente no seu retorno

Pedimos que você confirme item por item (✅ ok / ❌ achado, com detalhe):

1. **Arquivo solto / código morto** — algum arquivo `.ts` em `src/` sem
   nenhuma referência de import em nenhum outro lugar do projeto?
2. **Import não usado** — `npm run lint` (`oxlint --type-aware`) está
   limpo (0 avisos) em todo o histórico desta rodada, mas pedimos uma
   segunda verificação independente (ex.: `tsc --noEmit` com
   `noUnusedLocals`/`noUnusedParameters` habilitados temporariamente, ou
   outra ferramenta de sua escolha) — o `.oxlintrc.json` deste projeto
   não foi auditado quanto a quais regras exatas cobre por padrão.
3. **Linha com sintaxe errada / código quebrado** — `npm run build`
   (`nest build`) está limpo; confirme que não há nenhum arquivo fora do
   grafo de build (ex.: um `.ts` solto que nunca é importado por nada,
   logo nunca compilado, e pode conter erro sem que `build` o detecte).
4. **Fluxo de arquitetura incorreto** — a ordem dos guards globais
   (`ApiKeyGuard` → `JwtAuthGuard` → `PermissionsGuard`) em
   `app.module.ts` continua na ordem certa; o `LoggingInterceptor` e o
   `GlobalExceptionFilter` continuam cobrindo, juntos, toda requisição
   sem lacuna e sem duplicação (achado corrigido nesta rodada — validar
   que não regrediu).
5. **README com informação errada** — confira a tabela de 43 endpoints
   (`README.md` §5) linha a linha contra os controllers reais (método,
   URL, permission key, respostas) — nós conferimos isso da nossa parte,
   mas pedimos confirmação independente. Confira também `docs/ENDPOINTS.md`
   (documento irmão, mais detalhado, com "por que existe" em cada rota).
6. **Swagger com dado sensível exposto** — além do achado da senha
   mascarada (Pergunta 1), varra todos os `example` de todo DTO (`grep -rn
   "example:" src --include="*.dto.ts"`) atrás de qualquer outro valor
   que pareça uma credencial real, ou que revele estrutura interna
   (nome de tabela, coluna, constraint, algoritmo de hash).
7. **Rotas com validações corretas** — DTOs usam `class-validator`
   coerente com a regra de negócio real (ex.: `@MinLength`/`@MaxLength`
   batendo com o que o banco aceita, `@IsEnum` nos campos de status);
   `ValidationPipe` global com `whitelist: true, forbidNonWhitelisted:
   true, transform: true` continua ativo.
8. **API externa funcionando** — `CepService` contra o ViaCEP real
   (não mock) resolve CEP válido, rejeita CEP inexistente com `400`, e
   trata timeout/falha de rede sem bloquear a operação principal
   (`unavailable`, ver `src/common/cep/cep.service.ts`).
9. **Dados sensíveis nunca retornados** — `password`/`tokenHash`/
   `Document.path` nunca aparecem em nenhuma resposta de nenhuma rota
   (o `omit` global do Prisma cobre isso — confirme que nenhum service usa
   `omit: {password: false}` fora dos dois lugares que legitimamente
   precisam disso, já documentados: login interno e download de
   documento).
10. **CORS** — configurado (achado desta rodada), mas confirme que não
    abre nenhuma brecha de autorização (CORS não deveria substituir
    `x-api-key`/JWT como camada de segurança — só controla quem o
    NAVEGADOR deixa chamar).

## Contexto de regras de negócio (pra evitar falso-positivo na sua revisão)

Algumas coisas que PARECEM erro numa leitura rápida, mas são
intencionais — documentado aqui pra você não reportar como achado:

- `CANDIDATE` não tem nenhuma permissão `interview:*` — decisão de
  design original (Fase 1), não bug. Pacote específico sobre isso já foi
  mandado ao DeepSeek (`PACOTE-DEEPSEEK-INTERVIEW-CANDIDATO.md`), sem
  resposta ainda.
- `GET /companies/:id` não é restrito à própria empresa do RECRUITER
  (qualquer RECRUITER lê qualquer empresa), mas `GET /companies/:id/stats`
  **é** restrito — decisão consciente, dado agregado de contratação é
  mais sensível que nome/endereço.
- `/docs`/`/docs-json` são públicos de propósito (decisão revertida da
  recomendação anterior de exigir `x-api-key` — ver
  `docs/fases/TRIAGEM-REVISOES-RODADA15.md` pro motivo).
- Formato de erro tem duas versões convivendo (`Auth`/`Users` sem
  `reason`, módulos de domínio com `reason`) — decisão de não retroalimentar
  módulos já auditados, documentada no README §5.

## Verificação declarada (nossa parte)

`npm run build` limpo · `npm run lint` 0 avisos · `npm test` 9/9 ·
`npm run test:e2e` 155/155 · clone limpo do zero testado uma vez (achados
já corrigidos) · rotação de credencial testada nos dois ambientes ·
CORS testado ao vivo · dashboards do Grafana corrigidos e confirmados
contra o Loki real pela sessão de infraestrutura.

## O que pedimos como retorno

Uma lista, item por item do checklist acima (1 a 10) mais as 3
perguntas, cada um com ✅/❌ e o achado se houver. Se tudo estiver
✅, esse é o sinal verde final antes da apresentação.
