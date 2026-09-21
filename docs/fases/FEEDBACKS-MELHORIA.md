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

_Este arquivo é vivo: novos itens entram aqui sempre que identificarmos algo
tecnicamente correto para melhorar, mas que não deve competir por tempo com
o obrigatório dos 5 dias._
