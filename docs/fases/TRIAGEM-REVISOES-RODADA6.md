# Triagem das revisões — Qwen rodada 6 (Fase 2, Auth)

Resposta do time a `PARECER-QWEN-FASE2-AUTH-RODADA6.md`. Mesma legenda:
✅ aceito e corrigido · 📋 aceito, planejado pra fase futura · ⏸️ registrado,
sem ação agora · ⚖️ discordamos.

## Bloqueantes para fechar a Fase 2

| ID | Item | Veredito | Correção |
|---|---|---|---|
| N1-a | Conflito `Serializable` vira `500` cru (67% das corridas) | ✅ | Filtro de exceções unificado (`src/common/filters/global-exception.filter.ts`, substitui os dois filtros antigos), com um checador de duck-typing `isTransactionWriteConflict()` (`cause.kind === 'TransactionWriteConflict' \|\| cause.originalCode === '40001'`) rodando **antes** de qualquer outra checagem em `catch()`, devolvendo `409`. Testado: novo teste e2e (`test/auth.e2e-spec.ts`, descrito abaixo) cria 8 admins temporários e dispara 4 pares de desativação mútua simultânea via `Promise.all` — rodado 3× consecutivas, `14/14` verdes, zero `500` observado em nenhuma das rodadas. |
| N5-a | `pretest:e2e: prisma generate` falha sem `DATABASE_URL` (clone novo/CI) | ✅ | `prisma.config.ts`: trocado o helper estrito `env('DATABASE_URL')` por `process.env.DATABASE_URL ?? 'postgresql://placeholder:placeholder@localhost:5432/placeholder'` — `generate` não conecta em banco nenhum, só o comando que de fato precisa (`migrate`, `db push`...) vai falhar, e falha no lugar certo (erro de conexão claro), não num erro de config confuso antes de tentar. Testado: `.env` movido pra fora do diretório inteiro, `npx prisma generate` confirmado funcionando mesmo assim. |

## Ressalvas — destino

| ID | Item | Veredito | Detalhe |
|---|---|---|---|
| N1-b | Desenho: `Serializable` vs. `UPDATE` condicional | ⚖️ | Mantido `Serializable`. Registrado em comentário no próprio `deactivate()`: a invariante depende de um `count()` agregado sobre múltiplas linhas (quantos ADMIN estão ativos), diferente do caso de uma linha só (`filledCount`) onde o padrão condicional (`updateMany` + `count === 1`) se aplica bem. Com o `GlobalExceptionFilter` corrigido (N1-a), o custo do abort de transação é aceitável para uma operação de baixa frequência. |
| N1-c | Sem rota de reativação | ✅ | `UsersService.reactivate(targetId)` + `PATCH /users/:id/reactivate` (mesma permissão `user:manage`). Sem trava especial: reativar nunca zera admins (caminho oposto de `deactivate`), e é idempotente por natureza — reativar quem já está ativo não é erro. |
| N1-d | Comentário de `deactivate()` descrevia mecanismo errado | ✅ | Reescrito: descreve o mecanismo real (`DriverAdapterError`/`TransactionWriteConflict`, corrigido no `GlobalExceptionFilter`) e documenta explicitamente a decisão N1-b, em vez da afirmação falsa de que `P2034` resolvia isso. |
| #7 | Corpo do `401` inconsistente entre rotas | ✅ | Absorvido pelo `GlobalExceptionFilter`: toda `UnauthorizedException` passa pelo mesmo caminho — extrai a mensagem original (`getResponse()`, cobrindo tanto `string` quanto `{message}`), seta `WWW-Authenticate: Bearer` e devolve `401` com formato único. |
| #8 | `oxlint-disable-next-line` não suprime `unicorn/no-thenable` | ✅ | Comentário inline (não funcional, em nenhuma sintaxe testada) removido. Corrigido via `.oxlintrc.json` → `"overrides"` mirando só `src/config/env.validation.ts`, desligando a regra ali. Testado: `npm run lint` limpo. |
| #9 | Suíte e2e não reentrante | ✅ | `npm run db:reset:test` novo — apaga e recria só o `recrutamento_test` (`prisma migrate reset --force` + `prisma db seed`, ambos com `.env.test` carregado via o CLI do pacote `dotenv`). **Achado por execução, não previsto no pedido original:** `migrate reset`, nesta versão do Prisma, não dispara o seed sozinho (só existe um ponto de chamada do seed runner no código-fonte do CLI, ligado ao comando `db seed`) — por isso o script encadeia os dois comandos explicitamente, em vez de depender do reset "vir com seed junto" como versões antigas do Prisma faziam. Testado: reset rodado contra `recrutamento_test`, roles/users confirmados via query direta ao Postgres (zero antes do seed, populados depois), e os 14 testes e2e rodados de novo logo após o reset — todos verdes. |
| #10 | Key órfã loga aviso a cada request | ✅ | `WARNED_ORPHAN_KEYS` (um `Set` a nível de módulo) em `users.service.ts` — a mesma key só gera `Logger.warn` uma vez por processo, não uma vez por request autenticado. |
| #11 | Mensagem genérica do `P2025` | ✅ | Já resolvido no próprio `GlobalExceptionFilter` criado para N1-a: dicionário `MODEL_LABELS` (`User` → "Usuário", `Job` → "Vaga", etc.) usado na mensagem do `404`. |

## Nota sobre a trava de segurança do próprio Prisma (achado desta rodada, não do Qwen)

Ao validar `db:reset:test` por execução real (não só leitura de código),
`prisma migrate reset --force` recusou rodar sozinho, com uma mensagem
própria do Prisma proibindo agentes de IA de executar ações destrutivas
sem consentimento explícito do usuário em cada execução — pedimos
confirmação em chat duas vezes (uma vez em linguagem natural explicando
exatamente o comando/motivo/banco afetado, outra vez a confirmação literal
exigida pela própria trava do Prisma) antes de rodar. Nenhum dado de
`recrutamento_dev` foi tocado; a operação afeta só o `recrutamento_test`
(banco de teste descartável).

## Sugestões — destino

Nenhuma sugestão adicional além do já registrado em `FEEDBACKS-MELHORIA.md`
(N9 rate limiting, N15 pool do `pg`) veio nesta rodada.
