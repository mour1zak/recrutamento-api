# Parecer — Qwen (QA Lead & DevSecOps) — Fase 1, Rodada 2

> Registro do retorno recebido em resposta ao `PACOTE-QWEN-FASE1.md`
> atualizado (commit `38fd048`, RBAC dinâmico + API key). Conteúdo do Qwen,
> condensado mas fiel ao original, para manter o histórico de revisão. A
> triagem (o que foi aceito, corrigido, discutido ou recusado) está em
> `TRIAGEM-REVISOES-RODADA2.md` — **este arquivo é só o registro do que foi
> recebido, não a decisão final do time**.

**Veredito: REPROVADO (2ª rodada).** Motivo alegado: nenhuma das 6 falhas
críticas de uma rodada anterior (commit `c8b98e1`) teria sido corrigida, e a
adição de RBAC dinâmico + API key introduziu 3 falhas novas.

## Falhas apontadas como herdadas (rodada anterior, não detalhadas aqui em
## profundidade — o time não tem o relatório original completo)

- **C1** — Sem `CHECK`/lock no banco para `filledCount <= vacancies`;
  `UPDATE` direto no banco pode estourar o número de vagas.
- **C2** — `package.json`, `tsconfig.json`, `prisma.config.ts`,
  `.env.example` ausentes do repositório.
- **C3** — `password`/`tokenHash`/`path` podem vazar por `include` aninhado
  sem `omit`/`select` explícito no client gerado.
- **C4** — "Política de deleção de usuário contraditória (Cascade × Restrict)".
- **C5** — `User.companyId onDelete: SetNull` "destrói invariante de autorização".
- **C6** — `Application.resumeDocumentId` sem checagem de que o documento
  pertence ao mesmo candidato da candidatura; `Document.path` sem `@unique`.

## Falhas novas (introduzidas pelo RBAC dinâmico + API key)

- **C7** — RBAC dinâmico sem trava contra autoexclusão de permissão crítica
  e sem auditoria de concessão/revogação; `Permission → RolePermission
  onDelete: Cascade` revoga uma permissão de **todos** os papéis de uma vez,
  silenciosamente, ao apagar a `Permission`.
- **C8** — Camada de API key não tem modelo de dados próprio (chave única
  via `.env`, sem identidade de cliente, sem expiração/revogação
  individual); aplicá-la também a rotas públicas é descrito como
  autocontraditório para clientes públicos (SPA/mobile expõe a chave); o
  rótulo "Zero Trust" é contestado (é um *shared secret* estático, não Zero
  Trust).
- **C9** — Expansão de escopo (API key + RBAC Nível A/B + MFA condicional)
  sem nenhum item obrigatório do enunciado implementado ainda — veto ao
  Nível B nesta fase, recomendação de mover MFA para fora do escopo.

## Regressões apontadas

- **R1** — Perda de union type fechado para papel (antes `enum Role`, agora
  `Role.name: string` livre) — risco de typo não检检ado em compile-time.
- **R2** — Custo de 1 consulta extra ao banco por request para checar
  permissão, sem estratégia de cache/invalidação decidida.
- **R3** — `RolePermission` sem `@@index([permissionId])` — consulta
  reversa ("quais papéis têm a permissão X") faz varredura completa.
- **R4** — Endpoint de edição de permissões (Nível B) sem lock/versão —
  dois admins editando o mesmo papel simultaneamente se sobrescrevem.
- **R5** — Nomes `Role`/`Permission` colidem com palavras reservadas de
  privilégio do PostgreSQL (`GRANT role`, `pg_roles`) — sugestão de `@map`.

## Ressalvas herdadas da rodada anterior (não detalhadas — ver observação acima)

Enums com transições faltando (mesmo diagnóstico que o DeepSeek já cobriu
na Seção 3 do parecer dele); ausência de `.env.example`; falta de índices
compostos (`Application(jobId, status)`, `Job(companyId, status)`,
`RefreshToken.expiresAt`, `Document(ownerId, type)`); `updatedAt` sem
`DEFAULT` no DDL gerado; `sizeBytes Int` com risco teórico de overflow;
documentação com card cardinalidade `Document N──N Application` divergente
do schema real (1─N); README citando pasta `docker/` como já reservada
quando não está versionada.

## Sugestões de melhoria (opcionais, não bloqueiam)

Trava de "último administrador" via trigger no banco; revogação não
destrutiva em `RolePermission` (soft-delete com `revokedAt`); `omit` global
no `PrismaClient` como mitigação de C3; comparação em tempo constante +
redação de header em log para a API key; métrica de nº de queries do Guard
de permissão por request.
