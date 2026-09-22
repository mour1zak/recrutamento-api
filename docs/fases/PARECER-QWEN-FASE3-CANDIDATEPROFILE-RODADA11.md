# Parecer — Qwen (QA Lead & DevSecOps) — Fase 3: CandidateProfile, Rodada 11

> Registro do retorno recebido em resposta ao
> `PACOTE-QWEN-FASE3-CANDIDATE-PROFILE.md` (reapresentação da rodada 10).
> Condensado mas fiel ao original (relatório completo anexado pelo
> usuário, `RELATORIO-QWEN-FASE3-CANDIDATEPROFILE-RODADA11.md`). Triagem
> em `TRIAGEM-REVISOES-RODADA11.md`.

**Veredito: APROVADO COM RESSALVAS.** Os dois críticos da rodada 10 (C1
— PII de empresa desativada; C2 — `REJECTED`/`WITHDRAWN` destravando
perfil completo) foram reatacados com amplitude maior que a suíte do
projeto — matriz completa dos 7 status, sequências de transição,
candidaturas mistas na mesma empresa, cross-tenant, e o ciclo
desativar→404→reativar→acesso volta. Nada cedeu. P4 (409 espúrio no
upsert) também fechou, e melhor que o necessário: o retry preserva
semântica de PATCH parcial (4 campos escritos por 4 requisições
simultâneas sobreviveram todos).

## Achado novo (N1) — CEP×endereço inconsistente

Consequência direta da correção da ressalva 1 da rodada 10: como
`isResolvedAddress()` não distinguia "CEP inexistente" de "falha de
rede", um `PATCH` com CEP inválido passou a **preservar o endereço
antigo enquanto grava o `cep` novo** — o registro afirma duas coisas
contraditórias. A causa raiz é um contrato que o
`PARECER-DEEPSEEK-FASE1.md` §5 especifica desde a Fase 1
(`{status: 'ok'|'invalid'|'unavailable'}`) e nunca foi implementado — o
Qwen registrou que ele próprio deixou passar isso na rodada 8 (mediu "CEP
inexistente → 201" e marcou ✅ sem confrontar com o §5).

Correção pedida: `invalid` → `400` (ou não gravar o CEP); `unavailable`
→ preserva endereço + aviso; `ok` → sobrescreve. Com isso,
`isResolvedAddress()` deixa de ser necessário.

## Resposta à pergunta 3 do pacote (extrair lógica de escopo agora?)

Resposta dividida: **extrair `isAdmin()` agora** (função idêntica em
dois arquivos, sem variação de comportamento, custo zero); **não
extrair a checagem de empresa ativa agora** — os dois call sites lançam
`reason`s de 404 diferentes de propósito (`company_not_found` em Jobs,
`candidate_profile_not_found` em CandidateProfile), e um helper ingênuo
reintroduziria um canal de enumeração. Extrair só o predicado
(`isCompanyOperable`) quando `Application` existir, deixando cada módulo
decidir qual 404 lançar.

## Ressalvas

1. **N1** (acima) — obrigatória antes da Fase 5.
2. Duplicação de lógica de escopo — resposta acima.
3. `db:reset:test` falha em clone fresco (`ERR_MODULE_NOT_FOUND` no seed)
   — falta `prisma generate` antes do `db seed`.
4. README §5 descreve o reduzido como "candidatura `PENDING`", desatualizado
   desde o C2 da rodada 10.
5. Uma query a mais por leitura de perfil (`company.findUnique` separado)
   — baixo impacto, registrado.
6. Ressalvas 3/4 da rodada 10 (perfil de desativado legível; corpo do 413)
   — aceitas como adiadas com decisão escrita.
7. Herdadas (N1 do `roleName`, rate limiting, pool do `pg`, `CHECK`,
   `crypto.scrypt`, NFC, `familyId`, CI mínimo, trigger `companyId NOT
   NULL`) — aceitas, sem mudança.

## O que está bom

Lista positiva mudou a propriedade de segurança (status novo nasce
bloqueando, não destravando). Acesso revogado por transição, sem estado
residual. Anti-enumeração preservada ao reaproveitar padrão de outro
módulo (6 causas de 404, corpos byte-idênticos). Retry de P2002 preserva
PATCH parcial. Ciclo desativar/reativar funciona nos dois sentidos.
Suíte deixou de depender de rede externa sem perder cobertura real.
Decisões adiadas vêm com o raciocínio dentro do código. Teste
cross-tenant pedido na rodada 10 foi adicionado.

## Condições

1. N1 — contrato discriminado no `CepService`.
2. Extrair `isAdmin()`.
3. `prisma generate` no início de `db:reset:test`.
4. README §5 corrigido.
5. Antes de `Application`: predicado compartilhado de empresa operável
   (`reason` do 404 continua decisão do chamador).

Itens 5-7 das ressalvas podem seguir com dono e prazo.
