# Triagem das revisões — Qwen rodada 5 (Fase 2, Auth)

Resposta do time a `PARECER-QWEN-FASE2-AUTH-RODADA5.md`. Mesma legenda:
✅ aceito e corrigido · 📋 aceito, planejado pra fase futura · ⏸️ registrado,
sem ação agora · ⚖️ discordamos.

## Bloqueantes para fechar a Fase 2

| ID | Item | Veredito | Correção |
|---|---|---|---|
| N1 | Último ADMIN se autodesativa, sem reversão | ✅ | `UsersService.deactivate()` agora recebe `currentUserId`: recusa (`409`) se o alvo é a própria conta; recusa (`409`) se o alvo é o último ADMIN ativo. As duas checagens rodam dentro de `$transaction(..., { isolationLevel: 'Serializable' })` — um `count()` + `update()` em passos separados teria a mesma janela de corrida que o C4 já corrigiu em outro lugar (dois admins se desativando ao mesmo tempo). Testado: self-deactivation → `409`; dois admins se desativando simultaneamente → 1 sucesso (`204`), o outro barrado pela revalidação de sessão do próprio JWT antes mesmo de chegar na transação (defesa em profundidade funcionando em duas camadas). |
| N2 | `meta.target` não existe no Prisma 7 com driver adapter | ✅ | Leitura correta em `meta.driverAdapterError.cause.constraint.index`, com dicionário `CONSTRAINT_LABELS` mapeando cada constraint real da migration para um rótulo amigável (`User_email_key` → "email", etc.) — nunca o nome cru do índice. Testado: cadastro com email duplicado → `"Já existe um registro com o mesmo valor em: email."` |
| N3 | `default` classificava infraestrutura como `409` | ✅ | `P1xxx` → `503`; `default` → `500` (honesto, não sugere "foi você"). `409` fica restrito a `P2002`/`P2034`/`P2028`. |

## Ressalvas — destino

| ID | Item | Veredito | Detalhe |
|---|---|---|---|
| N4 | `.env.test` passa na validação fora de `NODE_ENV=test` | ✅ | `env.validation.ts` usa `.when('NODE_ENV', { is: 'test', ... })`: os valores do `.env.test` só são aceitos quando `NODE_ENV=test`; fora disso, são tratados como placeholder e recusados, igual ao `.env.example`. |
| N5 | Suíte e2e não roda em clone fresco (falta client gerado) | ✅ | `"pretest:e2e": "prisma generate"` adicionado ao `package.json`. |
| N6 | `DATABASE_URL` obrigatório até para `prisma generate`, não documentado | 📋 | Nota a adicionar no README (ver abaixo). |
| N7 | Mensagem de validação customizada do Joi não renderizava | ✅ | Trocado `helpers.error('any.custom', {...})` por `helpers.message({ custom: '...' })` — a API correta do Joi para mensagem literal de regra customizada. |
| N9 | Rate limiting ausente, 30 logins simultâneos, zero 429 | 📋 | Já registrado como pendência desde a Fase 1 (`FEEDBACKS-MELHORIA.md`); mantido, recomendado antes da Fase 3. |
| N10 | `/health` não verifica nada, exige API key | ⚖️ | Mantido como está — decisão CE-1 (sem exceções) é deliberada. Registrado que o endpoint hoje é *ping* de processo, não healthcheck de verdade. |
| N11 | README §5 (Endpoints) vazio com 5 rotas reais | ✅ | Tabela preenchida com as 5 rotas existentes. |
| N12 | Lint apontava `roleName: SystemRoleName \| string` redundante | ✅ | Trocado para `SystemRoleName \| (string & {})` — preserva autocomplete dos 3 papéis conhecidos sem apagar a checagem de tipo. |
| N13 | `as PermissionKey` sem validação | ✅ | `toAuthenticatedUser` agora filtra contra `KNOWN_PERMISSION_KEYS` e loga aviso (`Logger.warn`) se uma key gravada no banco não existe no catálogo. |
| N14 | `WWW-Authenticate` ausente no 401 | ✅ | `UnauthorizedExceptionFilter` novo, adiciona o header em toda resposta `401`. Testado com `curl -i`. |
| N15 | Pool do `pg` sem configuração | 📋 | Registrado para o Gate Fase 3 (`CONDICOES-ENTRADA-FASE2.md`) — configurar antes de escrever o teste de concorrência. |
| N16 | Senha do seed de teste pública, `.env.test` sem `SEED_USER_PASSWORD` | ⏸️ | Aceito como está (banco de teste local, guarda de `NODE_ENV=production` cobre o pior caso) — registrado nesta linha para não presumir proteção que não existe. |

## Sugestões — destino

`docker-compose.yml` + `make test`, CI mínimo, `crypto.scrypt`, normalização
NFC no `preHash`: todos já registrados ou reforçados em
`FEEDBACKS-MELHORIA.md`. Teste de concorrência formal na suíte (não só
evidência de auditoria) fica anotado como item a fazer antes de fechar a
Fase 2 de vez.

## Nota sobre o lint (N12)

A correção do tipo resolveu o aviso original. Uma correção posterior
(`.when()` do Joi para o N4) introduziu um novo aviso falso-positivo do
`oxlint` (`unicorn/no-thenable`, confundindo a opção `then`/`otherwise` da
API do Joi com uma Promise) — tentamos silenciar com comentário de
`disable` sem sucesso na sintaxe exata do `oxlint`; documentado como
falso-positivo conhecido, não bloqueia build nem testes.
