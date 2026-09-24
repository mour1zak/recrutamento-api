# Pacote para revisão — Qwen (QA Lead & DevSecOps) — Documentação Swagger (bônus, pós Fase 4/Interceptor)

Cole este documento inteiro na conversa com o Qwen.

---

Você é o **QA Lead / DevSecOps Specialist** do projeto `recrutamento-api`.
O obrigatório do enunciado está 100% fechado (Rodada 14) e o Gate Fase 3
também. Este pacote é sobre um item de **bônus**: documentação da API via
`@nestjs/swagger`. Não muda nenhuma regra de negócio, guard, service ou
schema já auditado — é metadado de documentação em cima de rotas que você
já atacou nas rodadas anteriores. O escopo de revisão pedido aqui é
estreito e específico: **uma decisão de exposição, não a lógica em si**.

## O que existe pra revisar

`src/main.ts` monta `SwaggerModule.setup('docs', app, document)` e expõe a
UI em `GET /docs` (e o JSON cru em `GET /docs-json`, comportamento padrão
do pacote). Todos os 41 endpoints da API estão documentados: tags em
português por módulo, `@ApiOperation`/`@ApiResponse` cobrindo cada código
HTTP que a rota realmente retorna (nunca um `500` documentado — os únicos
códigos listados são os que o `GlobalExceptionFilter`/services realmente
produzem), e todo DTO com `@ApiProperty`/`@ApiPropertyOptional` incluindo
as regras de negócio nas descrições (ex.: o campo `skills` de
`CandidateProfile` documenta o limite anti-abuso de 30 itens; o payload de
upload documenta os tipos MIME aceitos).

## A decisão que pedimos que você ataque

**`/docs` foi deixado FORA do `ApiKeyGuard`** — ou seja, é acessível sem
`x-api-key` e sem JWT. Motivo da decisão (registrada em comentário no
`main.ts`): guards do Nest não interceptam middleware Express bruto que o
`SwaggerModule.setup()` monta com `app.use()`, e tratamos documentação
pública como prática comum (é o que a maioria das APIs REST faz — Stripe,
GitHub, etc. documentam publicamente).

**O contra-argumento que nos preocupa:** isso significa que qualquer
pessoa, sem nenhuma credencial, consegue puxar `GET /docs-json` e obter o
mapa completo dos 41 endpoints, todos os nomes de campo, todos os enums de
status, e — pelas descrições que escrevemos — boa parte das regras de
negócio internas (ex.: que existe uma checagem de "último admin ativo",
que `RESCHEDULED` cria um novo registro em vez de editar, que documentos
tem duas permissões distintas por dono/por candidatura). Isso não vaza
dado de usuário nenhum, mas facilita reconhecimento (recon) pra quem for
atacar a API depois — é informação que hoje só existe pra quem tem acesso
ao repositório.

## Perguntas específicas

1. **Manter `/docs` público está correto**, ou deveria exigir pelo menos
   `x-api-key` (não JWT — documentação não é uma ação de usuário
   autenticado, mas poderia ainda exigir ser um "consumidor conhecido" da
   API)?
2. Alguma das descrições em português que escrevemos revela detalhe
   demais sobre a implementação interna (ex.: nomes de `reason` de erro,
   nomes de tabela, lógica de trava de concorrência) que um atacante
   externo não deveria ter de graça?
3. O `GET /docs-json` (JSON puro do OpenAPI, gerado automaticamente pelo
   pacote, sem rota nossa) também fica acessível sem API key — isso é
   esperado/aceitável no mesmo racional do item 1, ou merece tratamento
   diferente?
4. Existe algum campo sensível vazando no SCHEMA dos DTOs (não no dado em
   si, já que `@ApiProperty` documenta só a FORMA do campo) que não
   deveria estar documentado publicamente?

## Como está verificado

`npm run build` limpo · `npm run lint` 0 avisos · `npm test` 9/9 ·
`npm run test:e2e` 142/142 — nenhuma rota de negócio mudou, só decorators
adicionados. Testado manualmente no navegador: os 41 endpoints aparecem
em 9 tags (Saúde, Autenticação, Usuários, Empresas, Vagas, Perfil de
Candidato, Candidaturas, Entrevistas, Documentos, Papéis), os dois
esquemas de segurança (`x-api-key`, `Bearer JWT`) funcionam no botão
"Authorize", e os DTOs completos e reduzidos (ex.: `CreateApplicationDto`)
renderizam com exemplo e schema corretos.

## Se a resposta for "exigir API key em `/docs`"

Já temos o caminho técnico mapeado (não implementado ainda, aguardando seu
veredito antes de mexer): trocar `app.use('/docs', ...)` — que hoje o
próprio `SwaggerModule.setup()` decide internamente — por servir o
documento OpenAPI atrás de uma rota Nest normal (`@Public()` + um guard
próprio que só checa `x-api-key`, sem JWT), servindo a UI do Swagger a
partir de um HTML estático que aponta pra essa rota protegida. Se você
recomendar essa mudança, ela entra como próxima rodada antes de fechar o
bônus.
