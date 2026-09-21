# Feedbacks de Melhoria (não obrigatório, não é bônus do enunciado)

Este documento existe para separar três categorias que não podem se
confundir:

- **OBRIGATÓRIO** → `README.md` §2.1, direto do `AV-04-RECRUTAMENTO.md`.
- **BÔNUS** → `README.md` §2.2, lista fechada do próprio enunciado
  (paginação, filtros, ordenação, Swagger, seed, testes automatizados,
  Docker, indicadores).
- **MELHORIA (este arquivo)** → ideias tecnicamente corretas, que não fogem
  do domínio do projeto, mas que **não seriam feitas hoje** por não serem
  pedidas e/ou por custarem tempo desproporcional ao benefício dentro dos 5
  dias. Diferente de "conscientemente fora do escopo" (que é definitivo),
  aqui o item **pode** ser implementado se sobrar tempo real, sem
  comprometer o obrigatório — cada item tem status próprio.

Formato de cada entrada: o quê, por quê, custo estimado, status.

---

## 1. Particionamento de tabelas de histórico (`ApplicationStatusHistory`)

**O quê:** particionar `ApplicationStatusHistory` por `createdAt` (range
mensal/anual via `PARTITION BY RANGE`), com automação de criação/arquivo de
partições (ex.: extensão `pg_partman`).

**Por quê:** tabelas *append-only* (só crescem, nunca editam linha antiga)
acumulam dados para sempre. Em escala real (anos de operação, dezenas de
milhões de linhas), isso aumenta o custo de `VACUUM`/`autovacuum`, o tamanho
dos índices e o tempo de manutenção. Particionar permite: (1) *partition
pruning* — consultas por período só varrem a partição relevante, (2)
arquivamento/retenção quase instantâneo (`DETACH PARTITION` em vez de
`DELETE` linha a linha).

**Custo estimado:** médio-alto. O Prisma não gerencia particionamento
nativamente no `schema.prisma` — exige SQL bruto numa migration
(`prisma migrate dev --create-only` + edição manual) e, idealmente, uma
extensão como `pg_partman` para automação contínua. Não é "ligar uma flag".

**Status:** 🟡 Documentado, não implementado. Fora de escopo para os 5 dias
(o volume de dados da avaliação nunca chegaria perto de justificar isso).
Candidato real de melhoria se o projeto for adotado em produção.

---

## 2. Cache de permissões do RBAC dinâmico (mitigar custo por request)

**O quê:** já que o `PermissionsGuard` vai consultar `RolePermission` a cada
requisição (para refletir mudanças de permissão em runtime), avaliar um
cache com invalidação (ex.: versão de permissões no `User`, invalidada
quando um ADMIN edita `RolePermission` daquele papel).

**Por quê:** sem cache, cada requisição autenticada faz uma consulta extra
ao banco (`user → role → rolePermissions → permission`). Funcional, mas
adiciona latência que cresce com o número de usuários simultâneos.

**Custo estimado:** baixo a médio, mas tem implicação de segurança que
precisa ser decidida por escrito (janela de tempo em que uma permissão
revogada ainda pode estar "válida" no cache).

**Status:** 🟡 Documentado, não implementado. A versão sem cache (consulta
direta ao banco a cada request) é aceitável para o volume da avaliação e é
o que vamos entregar — mais simples e sempre correta, só mais lenta em
escala que não existe aqui.

---

## 3. Trava de "último administrador" via banco (não só via Service)

**O quê:** garantir por *constraint*/trigger no PostgreSQL (não só por
checagem no código) que o sistema nunca fique com zero usuários com papel
ADMIN ativo.

**Por quê:** uma checagem só no Service pode ser contornada por qualquer
caminho de código que não passe por ali (script de manutenção, migration
manual, bug futuro). Uma trava no banco é a última linha de defesa.

**Custo estimado:** baixo, mas é SQL fora do DSL do Prisma (trigger +
função em PL/pgSQL), escrito à mão na migration.

**Status:** 🟡 Candidato a melhoria. Decisão para a Fase 2: a trava mínima
viável (checagem no Service antes de rebaixar/desativar o último ADMIN)
**é obrigatória**; a trava redundante no banco fica aqui como melhoria.

---

## 4. Revogação não destrutiva de permissões (histórico de concessão/revogação)

**O quê:** em vez de `DELETE` físico em `RolePermission` quando uma
permissão é retirada de um papel, manter a linha com `revokedAt`/
`revokedById` (soft-delete) — assim a tabela se torna genuinamente
append-only e auditável, no mesmo padrão que já usamos em
`ApplicationStatusHistory`.

**Por quê:** sem isso, remover uma permissão não deixa rastro de quem
removeu, quando, ou o que existia antes — o que é uma lacuna real quando o
próprio ADMIN pode editar permissões em runtime (Nível B).

**Custo estimado:** baixo-médio: campo a mais + índice único parcial
(`WHERE revokedAt IS NULL`) via SQL na migration, e o Service passa a
"revogar" em vez de deletar.

**Status:** 🟡 Candidato forte de melhoria — avaliar promover para
obrigatório do Nível B antes da Fase 5, já que auditoria de mudança de
permissão foi uma lacuna explicitamente identificada na auditoria do
DEVCONNECT (ver `FASE-1-MODELAGEM.md` §7.2).

**Atualização (Qwen rodada 3, R-C7.1):** com `Permission → RolePermission`
agora em `Restrict` (correção da rodada 2), surgiu um efeito colateral: uma
`key` de permissão concedida por engano (ex.: `jobs:create` em vez de
`job:create`) fica **permanentemente impossível de remover do catálogo**,
porque `Restrict` bloqueia a exclusão enquanto houver qualquer concessão. A
revogação não-destrutiva (este item) resolveria isso também — vira parte do
mesmo pacote de decisão para o Nível B, não um item separado.

---

## 5. `CHECK` constraints no banco como rede de segurança adicional

**O quê:** `CHECK (filledCount <= vacancies)` e `CHECK (filledCount >= 0)`
em `Job`, como camada extra além da transação com lock da Fase 3.

**Por quê:** a transação com lock é a defesa primária contra a condição de
corrida; um `CHECK` no banco é uma segunda camada que barra qualquer
caminho que, por bug ou acesso direto ao banco, tente gravar um estado
fisicamente impossível.

**Custo estimado:** baixo — é SQL simples adicionado à migration.

**Status:** ✅ Promovido — decidido na triagem da rodada 2 de revisão
(`TRIAGEM-REVISOES-RODADA2.md`, item C1). Não é mais "melhoria condicional",
é parte do escopo confirmado da Fase 3, junto com a transação com lock.

---

## 6. Modelo próprio de API Key (tabela com hash, ao invés de valor único no `.env`)

**O quê:** em vez de uma única string fixa em `.env`, uma tabela `ApiKey`
(hash da chave, nome do cliente, `isActive`, `expiresAt`, `revokedAt`),
permitindo múltiplos clientes, rotação e revogação individual.

**Por quê:** uma única chave estática compartilhada por todo mundo não
identifica *qual* cliente fez a chamada, não pode ser revogada
individualmente, e — se vazar — precisa ser trocada para todos de uma vez.

**Custo estimado:** médio — schema novo + guard mais complexo + fluxo de
emissão/rotação de chave.

**Status:** 🟡 Decisão pendente para a Fase 2 (ver mensagem de análise
separada) — para os 5 dias, tende a ficar como está (valor único via `.env`
por ambiente), com a limitação documentada explicitamente no README, e essa
tabela registrada aqui como o caminho de evolução correto.

---

## 7. Estruturar o motivo de `REJECTED` (`Application`)

**O quê:** `ApplicationStatus.REJECTED` hoje serve pra três causas
diferentes (candidato não teve mérito, candidato recusou uma oferta, vaga
foi cancelada com candidaturas ativas). Melhoria: campo categórico de
motivo (ex.: `rejectionReason` em `ApplicationStatusHistory`, ou dividir em
mais valores de enum).

**Por quê:** sem isso, calcular métricas como "taxa de aceite de oferta" ou
"motivo de cancelamento em massa" exige heurística sobre texto livre do
campo `note` — achado da auditoria Qwen rodada 3.

**Custo estimado:** baixo (um campo a mais) a médio (dividir o enum, o que
teria efeito cascata em todo lugar que já trata `REJECTED`).

**Status:** 🟡 Pendente de decisão. `ApplicationStatusHistory.note` já
existe e pode registrar o motivo em texto livre — suficiente para o escopo
da avaliação, a menos que alguma métrica de funil vire requisito explícito.

---

## 8. `Application.coverLetter` (texto) vs `Document` tipo `COVER_LETTER` (arquivo)

**O quê:** hoje existem dois jeitos de representar "carta de apresentação"
— um campo de texto na candidatura e um tipo de documento (arquivo). Decidir
se os dois convivem (o candidato escolhe) ou se um deles é removido.

**Por quê:** duas fontes de verdade pra mesma informação de negócio, sem
regra de qual prevalece se ambos existirem — achado da auditoria Qwen
rodada 3.

**Custo estimado:** baixo — é decisão de modelagem, não estrutural (não
exige mudar o schema, só a regra de uso).

**Status:** 🟡 Pendente de decisão para a Fase 2.

---

## 9. Nomenclatura uniforme via `@map`/`@@map` (snake_case em tudo)

**O quê:** hoje só `Role`/`Permission`/`RolePermission` têm `@@map` (viraram
`app_roles` etc. pra evitar colisão com palavras reservadas do Postgres);
todo o resto continua com nome idêntico ao Prisma (`"User"`, `"Job"`...,
exigindo aspas em SQL cru). Melhoria: converter tudo pra snake_case via
`@map`/`@@map`, uniformizando a convenção.

**Por quê:** consistência + elimina a necessidade de aspas em qualquer SQL
bruto futuro (a Fase 3 já vai escrever `$queryRaw` para o `FOR UPDATE`) —
achado da auditoria Qwen rodada 3.

**Custo estimado:** baixo-médio — mecânico, mas toca todo o schema (risco
de esquecer um campo no meio do caminho).

**Status:** 🟡 Pendente de decisão — puramente estético/de convenção, não
corrige nenhum bug (diferente do `@@map` do RBAC, que corrigia colisão
real).

---

## 10. Frontend de apresentação (e impacto na arquitetura de API key)

**O quê:** um frontend simples (fetch puro ou Angular) só para apresentar o
projeto de forma mais visual — não pedido pelo enunciado, que é só backend.

**Por quê:** o usuário sinalizou interesse em ter isso como melhoria futura
para apresentação, não como parte da entrega técnica avaliada.

**Custo estimado:** médio-alto (é um projeto à parte), e tem uma implicação
arquitetural direta: a decisão de CE-1 (`CONDICOES-ENTRADA-FASE2.md`) — API
key global porque "não existe cliente navegador" — deixa de valer no
momento em que esse frontend existir e chamar a API diretamente do
navegador (a chave ficaria exposta no bundle JS). Se este item avançar, a
arquitetura de API key precisa ser revisitada antes: ou o frontend passa
por um backend-for-frontend (BFF) que guarda a chave no servidor, ou a API
key deixa de ser global.

**Status:** 🟡 Ideia registrada, sem decisão de fazer ou não. Não compete
por tempo com o obrigatório dos 5 dias.

---

## 11. `crypto.scrypt` no lugar de `bcryptjs`

**O quê:** trocar `bcryptjs` (puro JS) por `crypto.scrypt` da própria
stdlib do Node para hash de senha.

**Por quê:** achado da auditoria Qwen rodada 4 (medido: 72ms/operação para
`bcryptjs` com 10 rounds nesta máquina). `scrypt` resolve três problemas de
uma vez: (1) não depende de compilação nativa (era o motivo de termos
trocado `bcrypt` nativo por `bcryptjs`), (2) não tem limite de 72 bytes —
o pré-hash SHA-256 (`password.util.ts`) deixaria de ser necessário, (3) é
*memory-hard*, mais resistente a ataques com hardware dedicado (GPU/ASIC)
do que bcrypt.

**Por quê não agora:** trocar o algoritmo de hash depois que já existem
usuários com senha em bcrypt exige uma migração (rehash preguiçoso no
próximo login, mesma técnica já documentada em `auth.service.ts` para o
caso do `@MaxLength(72)`) — não é só trocar a função e seguir.

**Custo estimado:** médio — a troca em si é simples, a migração de senhas
existentes (mesmo sendo só dado de teste hoje) exige código de transição.

**Status:** 🟡 Registrado. `bcryptjs` + pré-hash SHA-256 continua sendo a
solução em produção nesta entrega — tecnicamente correta, só não é a mais
performática possível.

---

## 12. Detecção de reuso de refresh token via família (`familyId`)

**O quê:** adicionar `familyId` (ou `parentId`) em `RefreshToken`, de modo
que apresentar um token **já revogado** (não só expirado) revogue **toda a
família** de tokens daquela sessão, não só devolva `401`.

**Por quê:** achado da auditoria Qwen rodada 4 (C4, nota complementar):
token revogado sendo reapresentado é o sinal canônico de token roubado — a
prática recomendada é invalidar a sessão inteira, não só recusar aquele uso.

**Por quê agora é o momento de decidir:** o schema ainda não tem migration
"cara" (poucas linhas de dado) — adicionar o campo agora é barato; depois
de haver dados reais, mais caro.

**Custo estimado:** baixo-médio — um campo a mais + lógica de revogação em
cascata no `refresh()`.

**Status:** 🟡 Decisão explícita de adiar, registrada por pedido da própria
auditoria (não é obrigatório para a rodada 4, só precisa estar decidido por
escrito).

---

## 13. Seed derivar o catálogo completo de `PERMISSIONS`, não só de `ROLE_PERMISSIONS`

**O quê:** `prisma/seed.ts` hoje cria só as permissões que aparecem em
`ROLE_PERMISSIONS` (a união dos papéis). Se alguém adicionar uma key nova
em `PERMISSIONS` sem atribuí-la a nenhum papel ainda, ela nunca é criada no
banco — e o dia em que um Guard passar a exigi-la, todo mundo recebe `403`
silenciosamente, sem pista do motivo.

**Por quê não corrigido já:** hoje a união de `ROLE_PERMISSIONS` bate
exatamente com `PERMISSIONS` (28 = 28, verificado por execução na auditoria
rodada 4) — o risco existe, mas não está manifestado.

**Custo estimado:** baixo — trocar a fonte de `permissionKeys` no seed de
`Object.values(ROLE_PERMISSIONS).flat()` para `Object.values(PERMISSIONS)`.

**Status:** 🟡 Registrado (achado Qwen rodada 4, R11). Baixo risco atual,
correção barata quando for feita.

---

## 14. CI mínimo (`.github/workflows`)

**O quê:** pipeline `npm ci` → `prisma generate` → `lint` → `build` →
`test` → `test:e2e` contra um Postgres de serviço.

**Por quê:** achado da auditoria Qwen rodada 4 — é o que impede a suíte
vermelha (C3) de se repetir sem ninguém notar. Hoje nada no processo
detecta automaticamente uma suíte quebrada antes do próximo pedido de
revisão externa.

**Custo estimado:** baixo-médio — GitHub Actions com um serviço Postgres é
um template padrão, mas precisa de ajuste para `.env.test`/segredos de CI.

**Status:** 🟡 Registrado. Valioso, mas não bloqueia a Fase 2 — considerar
para a Fase 5 (entrega final) se houver tempo.

---

_Este arquivo é vivo: novos itens entram aqui sempre que identificarmos algo
tecnicamente correto para melhorar, mas que não deve competir por tempo com
o obrigatório dos 5 dias._
