# Parecer — Qwen (QA Lead & DevSecOps) — Fase 3: CandidateProfile, Rodada 10

> Registro do retorno recebido em resposta ao
> `PACOTE-QWEN-FASE3-CANDIDATE-PROFILE.md`. Condensado mas fiel ao
> original (relatório completo anexado pelo usuário,
> `RELATORIO-QWEN-FASE3-CANDIDATEPROFILE-RODADA10.md`). Triagem em
> `TRIAGEM-REVISOES-RODADA10.md`.

**Veredito: REPROVADO.** O módulo falha na única coisa que existe para
fazer: decidir quem vê qual PII, sob qual condição. Dois caminhos
alcançáveis pela API com credenciais legítimas expunham mais dado do que
o especificado.

## Críticos

**C1 — recrutador de empresa DESATIVADA continua lendo perfil completo**
(telefone, resumo, endereço). `getByUserId()` nunca checava
`company.isActive` do chamador — a metade de LEITURA do C3 (rodada 8),
que só corrigiu a metade de ESCRITA em `Jobs`. Prova com controle: no
mesmo token, `POST /jobs` já dava `404` (empresa inativa), mas `GET
/candidates/:userId` continuava `200` com telefone. Efeito permanente,
já que o acesso deriva de `Application` histórica, nunca apagada.

**C2 — `REJECTED` e `WITHDRAWN` destravam o perfil completo.** O
predicado `status !== PENDING` é uma negação que inclui qualquer coisa
que ninguém pensou em excluir. Consequência mais grave: `WITHDRAWN` —
o candidato **desistir** da candidatura tinha como efeito colateral
**aumentar** sua própria exposição de dados. `REJECTED` é pior em volume:
é o desfecho mais comum, e o desbloqueio é permanente (histórico não
volta a `PENDING`) — rejeitar um candidato passava a conceder acesso
definitivo aos dados de contato dele.

## Respostas às 4 perguntas do pacote

**P1 (consultar `Application` sem módulo próprio):** aceitável, com 3
condições — extrair para método compartilhado quando `Application`
existir; adicionar teste de escopo cross-tenant (o teste existente não
pegava regressão de filtro por empresa); registrar que `ApplicationStatus`
agora tem blast radius cross-module. **O escopo cross-tenant em si está
correto** — testado com candidato tendo `PENDING` numa empresa e
`UNDER_REVIEW` noutra: cada empresa vê exatamente o que devia, zero
contaminação.

**P2 (`companyId === null` reintroduziu o C1?):** não, confirmado por
execução em 8 combinações — mas a decisão está **duplicada** (`Jobs` tem
`isAdmin()`/`hasJobScope()` extraídos, aqui está inline) — mesmo padrão
que causou o C1 original. E o ramo ADMIN ainda decide por `roleName` (N1
da rodada 9), cujo impacto agora é maior: leitura irrestrita de PII de
todos os candidatos.

**P3 (vale mais testes de transição?):** o desenho (funções puras) está
certo, o predicado é que estava errado. Faltam: `REJECTED`, `WITHDRAWN`,
`HIRED`/`INTERVIEW` (completam a matriz), duas candidaturas na mesma
empresa em status diferentes, empresa desativada, candidato desativado.

**P4 (corrida no upsert é baixo risco?):** a premissa de integridade
está certa (sem linha duplicada, sem `5xx`), a de UX não — 37,5% das
requisições em 8 simultâneas recebiam `409` espúrio ("já existe um
registro") **enquanto o usuário editava o próprio perfil**. Também é o
único `409` de domínio sem `reason`.

## Ressalvas

1. Falha de CEP em UPDATE apagava endereço existente (mesmo padrão em
   `CompaniesService.update()`) — decisão tomada para `create` nunca foi
   reexaminada para `update`.
2. `skills[]` sem `@MaxLength` por item — 30 × 3.000 chars aceitos,
   ~90 KB no payload reduzido visível a qualquer recrutador com
   candidatura `PENDING`.
3. Perfil de usuário desativado continua legível — pode ser legítimo
   (histórico de processos em andamento), mas precisa ser decisão
   escrita.
4. Corpo do `413` fora do padrão (vem do body-parser, fora do filtro).
5. Suíte depende do ViaCEP vivo → flaky (2 falhas em ~9 execuções
   completas medidas).
6. README §2.1 diz "consultas por relacionamento: não iniciado", mas
   `GET /jobs*` já atravessa `company` e a visibilidade de perfil
   atravessa `Application → Job → Company`.
7. `GET /candidates/me` antes do primeiro `PATCH` devolve `404` — decisão
   de UX, registro apenas.

## O que está bom

Escopo cross-tenant correto (o maior risco do desenho, atacado primeiro).
Anti-enumeração byte-idêntica nos 4 motivos de 404. Sem mass assignment
(`forbidNonWhitelisted` rejeita `userId`/`isActive`/`roleId` no body).
Redução estrutural (campos ausentes, não `null`). `FULL_SELECT` nomeado
(padrão do DEVCONNECT finalmente adotado em domínio). As 5 correções da
rodada 9 reverificadas — inclusive 150 corridas concorrentes sem flake no
teste de concorrência de Jobs.

## Condições para reapresentação

1. C1 com teste (recrutador de empresa desativada → 404).
2. C2 com lista positiva de status + teste por status.
3. P4 sem `409` espúrio + `reason` correspondente.
4. Ressalvas 1, 2, 3 com decisão registrada.
5. Ressalva 5 — remover dependência do ViaCEP vivo como única forma de
   testar enriquecimento.
6. Teste de escopo cross-tenant na suíte.

Itens 4 (ressalva) e 6/7 (menores) podem seguir com dono e prazo.
