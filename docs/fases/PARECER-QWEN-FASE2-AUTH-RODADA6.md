# Parecer — Qwen (QA Lead & DevSecOps) — Fase 2: Auth, Rodada 6

> Registro do retorno recebido em resposta ao `PACOTE-QWEN-FASE2-AUTH.md`
> (rodada 6). Condensado mas fiel ao original (relatório completo anexado
> pelo usuário, `RELATORIO-QWEN-FASE2-AUTH-RODADA6.md`). Triagem em
> `TRIAGEM-REVISOES-RODADA6.md`.

**Veredito: APROVADO COM RESSALVAS.** A trava de último administrador (N1,
rodada 5) foi reexecutada sob carga adversarial pesada e **se sustenta**:
nenhum cenário conseguiu zerar os ADMINs ativos. Mas a auditoria encontrou
um defeito de contrato na própria mecânica da trava — o conflito de
transação `Serializable`, quando ocorre de verdade sob concorrência real,
não tinha o formato que o filtro de exceções reconhecia.

## Falha crítica nova — bloqueia o fechamento da Fase 2

**N1-a — conflito de transação Serializable vira `500` cru em 67% das
corridas concorrentes.** O `PrismaExceptionFilter` só reconhecia
`Prisma.PrismaClientKnownRequestError` com `code: 'P2034'`. Só que, com o
driver adapter (`@prisma/adapter-pg`, obrigatório no Prisma 7), o
`serialization_failure` real do Postgres (SQLSTATE `40001`) chega como um
`DriverAdapterError` **não exportado**, identificável só por duck-typing
(`cause.kind === 'TransactionWriteConflict'` /
`cause.originalCode === '40001'`) — nunca como
`PrismaClientKnownRequestError`. `P2034` é código morto com driver
adapter. Medido: 8 admins temporários, 4 pares de desativação mútua
simultânea, `500` em 67% das corridas.

## Bloqueante de infraestrutura

**N5-a — `pretest:e2e: prisma generate` falha em clone novo/CI.** O
helper estrito `env('DATABASE_URL')` do `prisma.config.ts` lança se a
variável não existir — mas `prisma generate` nunca toca banco nenhum,
só lê o schema. Em CI sem `.env` provisionado antes do primeiro
`npm ci && npm run build`, o pipeline inteiro quebra num passo que não
deveria depender de banco.

## Ressalvas (N1-b a N1-d, mais #7–#11 no relatório original)

- **N1-b** (nota de desenho, não bloqueante) — mantido `Serializable` em
  vez do padrão de `UPDATE` condicional (`updateMany` + `count === 1`,
  usado no `refresh()`/C4) porque a invariante depende de um agregado
  (`count()` sobre múltiplas linhas), não de uma linha só.
- **N1-c** — não existe rota de reativação; uma desativação errada
  (ex.: admin desativa o recrutador errado) era irreversível pela API.
- **N1-d** — o comentário de `deactivate()` afirmava (incorretamente)
  que `P2034` era o mecanismo real de proteção contra o conflito de
  concorrência.
- **#7** — corpo do `401` inconsistente entre rotas (`UnauthorizedException`
  às vezes some com a mensagem original).
- **#8** — `oxlint-disable-next-line` inline não suprime o falso-positivo
  `unicorn/no-thenable` em `env.validation.ts`, em nenhuma sintaxe
  testada.
- **#9** — suíde e2e não é reentrante: um teste interrompido no meio
  (crash, Ctrl+C) pode deixar o `recrutamento_test` num estado que
  quebra a próxima rodada. Sugestão: um script `db:reset`.
- **#10** — key de permissão órfã no banco loga um aviso a cada request
  autenticado (`toAuthenticatedUser` roda em todo
  `findAuthenticatedById`), devia logar uma vez por processo.
- **#11** — mensagem genérica do `P2025` ("registro não encontrado") sem
  dizer qual modelo.

## O que está bom (sustenta a aprovação)

A trava de último administrador **funciona** sob a carga adversarial mais
pesada aplicada até agora — o problema nunca foi a regra de negócio, foi
o formato do erro que ela produz sob a colisão real. Exigido para
fechar: um teste na suíte (não só evidência avulsa de auditoria) que
provoque esse conflito de propósito.

## Condições

**Para fechar a Fase 2:** N1-a (crítico — sem isso a trava aprovada em
rodada 5 continua causando `500` em produção sob a exata concorrência que
ela foi criada para proteger), N5-a (bloqueia CI/clone novo). **Ainda
nesta rodada, custo baixo:** N1-c, N1-d, #8, #10. **Registrado, sem
bloquear:** N1-b (decisão de desenho documentada), #7, #9, #11.
