# Parecer — Qwen (QA Lead & DevSecOps) — Fase 1, Rodada 3

> Registro do retorno recebido em resposta ao `PACOTE-QWEN-FASE1.md` (rodada
> 3). Conteúdo do Qwen, condensado mas fiel ao original (relatório completo
> em anexo do usuário, `RELATORIO-QWEN-FASE1-RODADA3.md`). A triagem está em
> `TRIAGEM-REVISOES-RODADA3.md`.

**Veredito: APROVADO COM RESSALVAS.** Autorizado iniciar a Fase 2, mediante
2 condições de entrada resolvidas antes do primeiro Guard/seed.

## Retratações (honestidade de processo)

- **C2 retirado**: verificado que `prisma validate` e `prisma generate`
  rodam sem `package.json`/`tsconfig.json`/`prisma.config.ts` — esses
  arquivos só são necessários para `migrate`, que é o primeiro ato da
  Fase 2, não da Fase 1. Viram **Condição de Entrada da Fase 2** (não mais
  falha da Fase 1).
- **Leitura de "escalada de privilégio" em C5 retirada**: o `fail-closed`
  do time (autorização falha quando `companyId` é `null`, `JwtStrategy`
  revalida no banco) está correto. Não há bypass de autorização.

## Confirmado como corrigido (testado em Postgres real)

`Permission → RolePermission` Restrict (C7 parte), `Document.path @unique`
(C6 parte), `@@index([permissionId])` (R3), `@@map` nas 3 tabelas RBAC
(R5), índices compostos em `Job`/`Application`/`Document`/`RefreshToken`,
correções de documentação (§1.3, README `docker/`, §6 registrando veredito
externo).

## Achado novo mais importante: `Role.isSystem` não protege nada

O comentário do schema afirmava proteção contra rename/exclusão que **não
existe** — provado: `UPDATE app_roles SET "isSystem"=false WHERE
name='ADMIN'`, `UPDATE ... SET name='XPTO'`, e `INSERT` de um novo papel
chamado `'ADMIN'` foram todos **aceitos**. Pedido: corrigir o comentário
para não prometer o que não é verdade, e registrar a proteção real como
requisito do Service (Nível B).

## C5 — cenário concreto (não é escalada de autorização, é perda de auditoria)

Sequência provada: `DELETE FROM "Company"` (sem vagas) é aceito → recrutador
fica com `companyId=null` (seguro) → é realocado para outra empresa →
**não existe nenhum registro de que ele já pertenceu à empresa apagada**.
`Company` não tem `isActive`/`deletedAt` (diferente de `User`, que tem).
Pedido: `Company.isActive` (espelhando `User`) ou modelagem explícita da
remoção de recrutador com autor/data.

## C4 — cenário concreto (remoção de usuário é bifurcada)

Usuário novo (sem candidatura) → `DELETE` **sucede**, cascade apaga
`CandidateProfile`/`RefreshToken`/`Document`, mas o **arquivo físico no
disco continua órfão**. Usuário com candidatura → `DELETE` **bloqueado**
por FK, devolveria `P2003` cru (500) se não tratado. Mesma operação, dois
comportamentos dependendo do conteúdo do banco. Também provado: desativar
um usuário (`isActive=false`) **não revoga** `RefreshToken` ativos —
usuário desativado consegue, em tese, renovar sessão.

**Exigências vinculantes (R-C4.1/2/3):** desativação revoga refresh tokens
e o fluxo de refresh revalida `isActive`; `DELETE` físico de `User` não é
um caminho suportado (ou não existe endpoint, ou vira `409` tratado); ciclo
de vida do arquivo físico do `Document` precisa de resposta.

## Condições de Entrada da Fase 2 (bloqueiam o primeiro Guard/seed)

- **CE-1** — Definir quem é o consumidor da API antes de escrever o guard
  de API key: (i) sempre um cliente confiável tipo backend/Postman (então
  API key global faz sentido, inclusive em rotas "públicas"), ou (ii)
  existe cliente navegador/SPA (então a API key não pode ser exigida nas
  rotas que ele chama). `FASE-1-MODELAGEM.md` §5.1 hoje afirma as duas
  coisas ao mesmo tempo.
- **CE-2** — Versionar o catálogo de 28 permission keys como código (módulo
  compartilhado entre seed e Guards), não deixá-lo só em prosa no parecer
  do DeepSeek — mesma lição da fórmula duplicada Service/seed já registrada
  no `refeitorio-api`.

## Ressalvas com exigência vinculante (resumo — íntegra no arquivo do usuário)

- R-C1.1/1.2 — `CHECK` no banco pega o sintoma, não a causa; a defesa forte
  é derivar `count(HIRED) <= vacancies` dentro do lock, não só confiar no
  contador armazenado; e verificar que o `CHECK` sobrevive a um `migrate
  dev` posterior.
- R-C3.1 — `omit` global não cobre `$queryRaw` (que a Fase 3 vai usar) —
  restringir SQL cru às colunas necessárias.
- R-C7.1 — quando o Nível B existir: trava de último admin, revogação não
  destrutiva com autor, proibição de delete de papel via endpoint, caminho
  de "aposentadoria" para `Permission` (hoje uma key errada já concedida
  fica permanentemente impossível de remover, por causa do `Restrict`).
- R-401.1 — política de precedência 401/403/404/409 precisa virar tabela de
  casos de teste na Fase 2; decidir se `401` vem com header
  `WWW-Authenticate` (RFC 9110).
- Enums: `REJECTED` sobrecarregado (mérito, recusa de oferta, cancelamento
  de vaga — três causas, um valor); `CANCELED` vs `RESCHEDULED` de
  `Interview` ambíguos depois do `previousInterviewId`; falta estado para
  "entrevista cujo horário passou sem ação"; falta invariante impedindo
  criar `Interview` para `Application` já `WITHDRAWN`.
- Herdadas sem tratamento ainda: `email` case-sensitive/sem trim; `cnpj`
  sem validação de formato; sem limite de tamanho em campos de texto
  (`password` é o caso que importa — bcrypt trunca em 72 bytes em
  silêncio); `coverLetter` (texto) vs `DocumentType.COVER_LETTER` (arquivo)
  como duas fontes de verdade; `updatedAt` sem `DEFAULT` no DDL (vai
  importar porque a Fase 3 escreve SQL à mão); `skills String[]` sem índice
  GIN se houver filtro por habilidade.

## Sugestões de melhoria

Derivar `filledCount` por contagem em vez de armazenar; fonte única
versionada para o catálogo de permissões; `@map`/`@@map` para snake_case em
**todas** as tabelas (não só as 3 do RBAC), eliminando aspas em todo SQL
cru da Fase 3; registrar no README §2.4 ("conscientemente fora do escopo")
as decisões que a triagem já tomou mas que hoje só existem em
`TRIAGEM`/`FEEDBACKS`; teste de fumaça de migration no CI da Fase 2.

## Conclusão do Qwen

"O que mudou o veredito não foi argumento, foi evidência de processo" — a
triagem item a item, o §6 deixando de ser autoavaliação, e o
resequenciamento do Nível B. Pontos de verificação para as próximas fases:
Gate Fase 2 (toolchain versionado, `omit` global, catálogo de permissões em
fonte única, R-C4.1 implementado e testado, CE-1 decidido), Gate Fase 3
(`CHECK` com prova de sobrevivência a `migrate dev`, teste `Promise.all` em
Postgres real assertando as duas invariantes, erros do Prisma mapeados para
409/400 nunca 500), Gate Nível B (os 4 itens do R-C7.1).
