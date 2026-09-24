# Pacote para revisão — Qwen (QA Lead & DevSecOps) — Auditoria Final Completa

Cole este documento inteiro na conversa com o Qwen.

---

Você é o **QA Lead / DevSecOps Specialist** do projeto `recrutamento-api`,
e já auditou 15 rodadas ao longo de toda a implementação (Fase 1 até
Swagger/Rodada 15). Este é o **último pacote** — o projeto está,
segundo nós, pronto pra entrega/apresentação, e pedimos uma auditoria
final de ponta a ponta contra o **enunciado original completo**
(`AV-04-RECRUTAMENTO.md`, colado abaixo na íntegra), não contra um
módulo específico. Diferente dos pacotes anteriores, este não parte de
"o que mudou desde a última rodada" — parte de **tudo que foi pedido,
desde o início**, e pede pra você confirmar ou refutar que cada item foi
atendido de verdade, com execução real, não por leitura de comentário.

## O enunciado original, na íntegra

```markdown
# Avaliação de 5 Dias — Plataforma de Recrutamento

## Contexto e objetivo
Projete e implemente uma API backend completa para Plataforma de
Recrutamento. A avaliação tem duração de 5 dias. A solução será
observada pela modelagem, arquitetura, integração entre componentes,
regras de negócio, segurança, tratamento de erros, testes e qualidade da
entrega.

## Stack e conteúdos obrigatórios
- NestJS + TypeScript
- PostgreSQL
- Prisma 7.10.0, prisma.config.ts, driver adapter e migrations
- DTOs, class-validator e ValidationPipe
- JWT e @CurrentUser() ou mecanismo equivalente
- autorização por papel/permissão
- relacionamentos Prisma
- upload de arquivo
- HttpService
- pelo menos um Interceptor útil
- .env / ConfigService
- Helmet
- Compression
- tratamento coerente de 400, 401, 403, 404 e 409
- build de produção
- README/documentação

## Perfis
CANDIDATE, RECRUITER, ADMIN. Defina uma matriz de permissões coerente.
Usuários não podem manipular recursos de terceiros apenas alterando IDs
na requisição.

## Entidades mínimas
User, Company, Job, CandidateProfile, Application, Interview, Document.
Modele cardinalidades, constraints, enums e estados necessários. É
permitido criar entidades associativas e auxiliares.

## Funcionalidades mínimas
- autenticação; CRUD/gestão das entidades administrativas relevantes;
  operações do usuário autenticado; consultas por relacionamento; fluxo
  de estados do domínio; histórico quando necessário; autorização;
  validações; tratamento dos conflitos de negócio.

## Regras obrigatórias
Candidatura duplicada proibida; vaga inativa não aceita candidatura;
recruiter só opera vagas da própria empresa. Além dessas regras:
referências a recursos inexistentes devem ser tratadas; operações
incompatíveis com o estado atual devem ser rejeitadas; transições de
status precisam ser coerentes; dados sensíveis não podem aparecer nas
respostas; operações pessoais devem usar a identidade autenticada.

## Endpoints
Defina uma API REST suficiente para executar todos os fluxos descritos.
O README deve listar método, URL, autenticação/permissão, body esperado
e principais respostas de cada endpoint.

## Upload obrigatório
Implemente upload de currículo/documento. Valide presença, tamanho e
tipo do arquivo. O upload deve estar conectado a uma funcionalidade real
do domínio.

## Integração externa
Utilize HttpService para consumir CEP/localização da empresa. URL/
configurações devem vir do ambiente e erros/timeout precisam ser
tratados. Pode ser utilizada uma API mock disponibilizada para a
avaliação quando necessário.

## Interceptor
Implemente pelo menos um Interceptor coerente, como: log estruturado;
tempo de execução; transformação padronizada da resposta. Documente sua
finalidade. Não coloque regra principal de negócio no Interceptor.

## Segurança e performance
JWT secret por ambiente; .env fora do Git; Helmet habilitado; Compression
habilitado; rotas privadas protegidas; autorização testada; logs sem
segredos; senhas nunca retornadas.

## Testes obrigatórios
Demonstre: 1. fluxo principal com sucesso; 2. body inválido → 400;
3. ausência/token inválido → 401; 4. usuário autenticado sem permissão →
403; 5. recurso inexistente → 404; 6. conflito da regra de negócio → 409;
7. tentativa de acesso a recurso de terceiro; 8. upload válido e
inválido; 9. integração externa funcionando e falhando de forma
controlada; 10. fluxo completo de mudança de estado.

## Entregáveis
código-fonte; schema Prisma e migrations; .env.example; README completo;
documentação/lista de endpoints; exemplos de requisição; instruções de
instalação, migration, execução e build; npm run build finalizando sem
erros.

## Bônus
Somente depois do obrigatório: paginação, filtros, ordenação, Swagger,
seed, testes automatizados, Docker ou indicadores do domínio.
```

## O que pedimos, especificamente

Não é uma revisão de código nova — é uma **conferência de cobertura**.
Para cada seção do enunciado acima, verifique contra o código/testes
reais (rode, não leia comentário) e aponte qualquer item que:

1. **Nunca foi implementado** (falso "concluído" no README).
2. **Foi implementado mas regrediu** numa rodada posterior (uma correção
   de rodada N quebrada silenciosamente por uma mudança de rodada N+k).
3. **O README afirma algo que a execução não confirma** — é exatamente o
   critério que reprovou a rodada 4 (C3) e a rodada 14 (asserção
   exclusiva demais), e não queremos que ele reapareça no pacote final.

## Pontos específicos que já sabemos ser frágeis (peça pra olhar com mais força)

1. **Tabela de endpoints do README (§5)** — nós mesmos achamos, preparando
   este pacote, que `GET /cep/:cep` (adicionado numa sessão recente,
   fora do mapa original de 41) tinha ficado documentado só em prosa
   (§2.3), faltando na tabela principal — já corrigido, mas pede uma
   conferência linha a linha da tabela inteira contra os controllers
   reais (método, URL, permission key, body, códigos), não só esse um
   caso. Se há mais divergências desse tipo, é exatamente o tipo de coisa
   que queremos que você encontre agora, não o avaliador depois.
2. **"Exemplos de requisição" como entregável explícito do enunciado** —
   o README não tem blocos de exemplo de request colados no arquivo; a
   estratégia foi apontar pro Swagger (`/docs`, com `@ApiProperty({example})`
   em todo campo de todo DTO) como a fonte de exemplos. Isso satisfaz o
   requisito, ou o avaliador esperaria ver isso no próprio arquivo
   Markdown?
3. **Bônus "indicadores do domínio"** — não implementado. Temos
   observabilidade de INFRAESTRUTURA (Grafana/Loki, logs HTTP), mas
   nenhum indicador de NEGÓCIO (ex.: vagas abertas por empresa, tempo
   médio até contratação, taxa de conversão de candidatura). Confirme se
   isso deveria ter sido feito antes de "fechar" os bônus, ou se os 5
   outros itens de bônus (paginação parcial, seed, testes, Docker,
   Swagger) já bastam pra essa linha do enunciado ("Somente depois do
   obrigatório: [lista com 7 itens] " não exige todos, é uma lista de
   opções — mas vale sua leitura).
4. **Decisão final sobre `/docs` público** (Rodada 15) — revertemos a sua
   recomendação de exigir `x-api-key` por causa de UX ruim do Basic Auth
   no navegador. A correção que importava (credencial real vazada no
   `example`) continua aplicada. Considerando o enunciado completo (não
   só a rodada 15 isolada), essa decisão final ainda é aceitável pra
   você, ou a exposição pública da documentação compromete algum
   requisito de segurança que o enunciado pede explicitamente
   ("autorização testada", "rotas privadas protegidas")?
5. **Paginação/filtros/ordenação (bônus)** — ordenação continua fixa
   (`createdAt desc`), não configurável pelo cliente. Isso é aceitável
   como bônus parcial, ou deveria ser tudo-ou-nada?

## Estado declarado (verifique cada número)

- **158 testes automatizados** (9 unitários + 149 e2e), todos verdes.
- **42 endpoints** documentados no Swagger (41 do mapa original do
  DeepSeek + `GET /cep/:cep`).
- **10 de 10 cenários obrigatórios de teste** do enunciado cobertos.
- **Gate Fase 3** (concorrência: `CHECK` de banco, trigger `updatedAt`
  UTC, índice case-insensitive de email, pool do `pg`) fechado.
- `npm run build` limpo, `npm run lint` 0 avisos, `.env` fora do Git
  (confirmado via `git check-ignore`).
- README com: pré-requisitos (Node 22+/testado 24.18.0, PostgreSQL
  14+/testado 18, versões de todas as dependências-chave que o enunciado
  cita por nome), passos de instalação/migration/execução/build em
  ordem cronológica testada, seção dedicada ao Swagger com a rota e como
  usar o botão Authorize, tabela completa de 42 endpoints.

## O que pedimos como veredito final

Não é mais "aprovado com ressalvas" rodada a rodada — é: **este projeto,
como está agora, atende o enunciado da AV-04-RECRUTAMENTO por completo?**
Se sim, com quais ressalvas remanescentes (se houver) registradas pra
constar. Se não, o que especificamente falta antes de considerar a
entrega pronta.
