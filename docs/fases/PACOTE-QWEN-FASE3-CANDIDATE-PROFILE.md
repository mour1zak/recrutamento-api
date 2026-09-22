# Pacote para revisão — Qwen (QA Lead & DevSecOps) — Fase 3: CandidateProfile

Cole este documento inteiro na conversa com o Qwen.

---

Você é o **QA Lead / DevSecOps Specialist** do projeto `recrutamento-api`.
Na Rodada 9, você aprovou Companies + Jobs (com ressalvas registradas).
Este é o terceiro módulo de domínio, ainda **não revisado por você**:
`CandidateProfile` (3 rotas).

## O que existe pra revisar

`GET /candidates/me` · `PATCH /candidates/me` (upsert — não existe `POST`
separado, o perfil nasce na primeira atualização) · `GET /candidates/:userId`.

**A parte sensível é a visibilidade condicional de `GET /candidates/:userId`**
(Fase 1, Pergunta 2 do parecer do DeepSeek), decidida consultando a
tabela `Application` **diretamente via Prisma** — o módulo Application
ainda não tem controller próprio, mas o schema já modela a relação
desde a Fase 1:

- Dono do perfil ou ADMIN → sempre completo.
- RECRUITER → só enxerga se existir alguma `Application` do candidato
  pra uma vaga da própria empresa (`404` caso contrário — nunca `403`,
  mesma política anti-enumeração do resto do projeto); **completo** se
  alguma candidatura já saiu de `PENDING`; **reduzido**
  (`id, name, headline, skills`, sem `summary/phone/endereço`) se só
  existir candidatura `PENDING`.
- Usuário alvo que não é `CANDIDATE` (ex.: tentar consultar o perfil do
  próprio ADMIN) → `404` (nunca revela que o `userId` existe mas não é
  candidato).
- Outro CANDIDATE sem nenhuma relação → `404`.

## O que já testamos por execução

12 testes e2e novos (`test/candidate-profile.e2e-spec.ts`), incluindo:
perfil inexistente → `404`; upsert cria o perfil; dono/ADMIN veem
completo; usuário não-candidato → `404`; candidato sem relação → `404`;
RECRUITER sem candidatura → `404`; candidatura `PENDING` → reduzido
(campos sensíveis literalmente ausentes do JSON, não só vazios);
candidatura avança pra `UNDER_REVIEW` → completo; CEP real (ViaCEP, sem
mock) enriquecendo o endereço do candidato, mesmo `CepService` já
auditado em Companies.

## Pontos que gostaríamos que você atacasse especificamente

1. **A consulta direta à tabela `Application` sem o módulo existir** —
   isso é uma dívida técnica aceitável (o schema já modela a relação) ou
   deveria esperar o módulo Application existir primeiro?
2. **`companyId === null` para RECRUITER** — reusamos o mesmo guard que
   `JobsService` usa (tratado como "sem acesso", não "acesso global").
   Confirmar que não reintroduzimos o padrão do C1 (rodada 8) aqui.
3. **`toReducedResponse`/`toFullResponse`** são duas funções puras que
   decidem o formato da resposta — mas a decisão de QUAL delas chamar
   está espalhada em `getByUserId()`. Vale a pena um teste que force
   exatamente a transição de estado (`PENDING`→`UNDER_REVIEW`) no meio
   de duas leituras, como fizemos, ou você recomendaria mais casos?
4. **Corrida:** dois `PATCH /candidates/me` simultâneos do mesmo
   candidato (upsert). Não testamos concorrência aqui — é um cenário de
   baixo risco (mesmo dono, mesma linha, sem invariante entre linhas
   como em Jobs) ou merece atenção?

## Verificação

`npm run build` limpo · `npm run lint` 0 avisos · `npm test` 4/4 ·
`npm run test:e2e` 68/68 (**72 testes no total**) · confirmado que os
campos reduzidos (`summary`, `phone`) ficam literalmente ausentes do
JSON quando a candidatura está `PENDING`, não só `null`.
