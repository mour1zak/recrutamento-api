# Parecer — Qwen (QA Lead & DevSecOps) — Interceptor de Logging, Rodada 14

> Registro do retorno recebido em resposta ao
> `PACOTE-QWEN-INTERCEPTOR.md`. Condensado mas fiel ao original
> (`RELATORIO-QWEN-INTERCEPTOR-RODADA14.md`). Triagem completa em
> `TRIAGEM-REVISOES-RODADA14.md`.

**Veredito: REPROVADO, por um motivo só, e não é o interceptor.** A
suíte declarada `139/139` estava vermelha de forma reproduzível: rodando
`test/roles.e2e-spec.ts` isolado 12 vezes, 11 falharam (92%). Causa: uma
asserção no teste de concorrência de K2 aceitava só o `reason`
`concorrencia_transacao`, mas o `409` daquela corrida tem **dois**
desfechos legítimos — conflito de serialização do Postgres, OU a regra
de negócio (`sem_papel_com_role_manage`) disparando pelo caminho
esperado quando uma transação commita antes da outra contar. O teste
tratava o segundo caminho (a trava funcionando) como falha. É a mesma
classe de erro da rodada 9 (N2): assertar QUAL desfecho legal aconteceu,
em vez de assertar o invariante.

## O interceptor em si: aprovado em tudo que foi atacado

- Status logado é sempre o real (7/7 rotas testadas, incluindo `201` e 3
  tipos de erro).
- Não vaza corpo, não há injeção de log (URL cru preserva percent-encoding).
- Não interfere nas provas de concorrência de K1/K3 (interceptor sem
  estado compartilhado).
- Sem side-channel de timing (a equalização de senha da rodada 5
  continua valendo mesmo com duração exposta no log).
- Ressalva 1 da rodada 13 (`reason` no 409 de conflito) confirmada
  fechada nos 3 caminhos do filtro.

## Ressalvas (nenhuma de defeito, todas de cobertura/higiene)

- **R1 (a mais importante):** rejeições de guard (401 de API key/JWT, 403
  de permissão) e rota inexistente (404) não geravam NENHUMA linha de
  log — guards rodam antes de interceptors no Nest. Documentação
  afirmava "toda requisição" sem essa ressalva.
- R2: duração logada exclui o tempo do guard (consulta ao banco do
  `JwtStrategy`), subestimando a latência real de rotas autenticadas.
- R3: URL sem limite de tamanho no log (até ~16KB por requisição).
- R4: nenhuma redação de query param com cara de segredo, se um cliente
  mal configurado mandar um ali.
- R5: requisição abortada pelo cliente não gera log (`tap` sem `finalize`).
- R6: README afirmava "100% concluído"/"10 de 10" ao lado de uma suíte
  vermelha — mesmo descompasso de honestidade que reprovou a rodada 4.

## Condições

**Bloqueante:** corrigir a asserção pra aceitar
`['sem_papel_com_role_manage', 'concorrencia_transacao']`, e registrar a
regra de teste de concorrência do projeto (assertar invariante + conjunto
de códigos aceitos, nunca o desfecho de um ramo único).

**Antes da Fase 5:** R1 (logar rejeições de guard/rota — o
`GlobalExceptionFilter` já as vê) e R6 (README refletindo o estado real).

**Desejável:** R2-R5.
