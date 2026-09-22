# Parecer — Qwen (QA Lead & DevSecOps) — Fase 4, Rodada 12

> Registro do retorno recebido em resposta ao
> `PACOTE-QWEN-FASE4-DOMINIO-RESTANTE.md` (primeira auditoria de
> Application, Interview, Document, Users e RBAC Nível B — 5 módulos
> implementados de uma vez, sob orçamento de tempo apertado, sem ciclo de
> auditoria prévio). Condensado mas fiel ao original
> (`RELATORIO-QWEN-FASE4-RODADA12.md`). Triagem completa em
> `TRIAGEM-REVISOES-RODADA12.md`.

**Veredito: REPROVADO.** Seis críticos, todos reproduzidos por execução
real contra PostgreSQL. Confirma a hipótese do próprio pacote enviado:
código nunca auditado repete as mesmas três classes de bug já corrigidas
em módulos anteriores (check-then-write sem atomicidade; escopo por
ausência de checagem).

## Os seis críticos

| # | Achado | Taxa medida |
|---|---|---|
| K1 | `HIRED` × redução de `vacancies` → `filledCount > vacancies` | 15/25 (60%) |
| K2 | Trava "último papel com `role:manage`" furada por 2 `PUT` simultâneos | 10/12 (83%) |
| K3 | Trava "último ADMIN ativo" em `PATCH /users/:id/role` furada pela mesma corrida | 10/12 (83%) |
| K4 | `PATCH /users/:id/company` com `{}` → `500` | 100% |
| K5 | Empresa desativada não bloqueia leitura em Applications/Interviews/Documents | 100% |
| K6 | Candidatura qualificada libera TODOS os documentos do candidato, não só os anexados | 100% |

**Causa raiz comum dos 3 primeiros:** comparação/decisão feita com um
valor lido ANTES da escrita (ou fora da transação), não contra a coluna
no instante do commit — a mesma classe que motivou o `updateMany`
condicional de Jobs/Auth. **Causa raiz dos 3 últimos:** helper de escopo
(`isCompanyOperable`) e regra de vínculo explícito existiam, mas não
foram propagados a todos os call sites que precisavam deles.

## O que o Qwen confirmou estar correto

Isolamento cross-tenant em Applications/Interviews, IDOR de
`resumeDocumentId` fechado, `companyId === null` fail-closed, contrato de
`RESCHEDULED` completo, anti path-traversal e anti header-injection no
upload, `isAdmin()`/`isCompanyOperable()` corretamente extraídos como
recomendado na rodada 11, suíte estável (131/131, 3×), lint/build limpos.

## Ressalvas (11, não bloqueantes para reapresentação)

`interviewerId` não validado (aceita o próprio candidato ou recrutador de
outra empresa); `scheduledAt` no passado aceito; campos de `Interview`
(`location`/`meetingLink`/`durationMinutes`/`isRemote`) inalcançáveis
pela API; listagem de Applications expõe mais que o detalhe reduzido;
`PATCH /users/:id/company` sem checar `isActive` da empresa nem guarda de
vagas ativas; MIME whitelist confia no `mimetype` declarado pelo
cliente; ciclo de vida do arquivo físico (órfãos em `uploads/`);
`originalName` com mojibake (decodificação latin1) e sem sanear
CR/LF; `CHECK` ausente (agora corrigido — ver K1); corpo do `500` sem
`error`; `findOne` de Applications/Documents sem `@Permissions` visível
em metadata.

## Sugestões

Helper único de "escrita condicional" reutilizável; `CHECK` como rede
(não substituto) do código; testes de concorrência por invariante, nunca
por "exatamente um 200"; CI mínimo (pegaria K4 sozinho).
