# Roteiro de validação manual (Postman)

Cobre as 18 rotas implementadas até agora (Auth, Users, Companies, Jobs).
Validado por execução real contra o servidor de dev antes de ser
entregue — todos os status/reasons abaixo foram conferidos, não é só
teoria.

## Como importar

1. Abra o Postman → **Import** → arraste os dois arquivos desta pasta
   (`recrutamento-api.postman_collection.json` e
   `recrutamento-api.postman_environment.json`).
2. No canto superior direito, selecione o ambiente **"recrutamento-api
   (local)"**.
3. Clique no ícone de olho do ambiente → **Edit** → cole o valor real de
   `API_KEY` do seu `.env` na variável `apiKey` (nunca commitado aqui de
   propósito).
4. Confirme que a API está rodando (`npm run start:dev`) contra o banco
   `recrutamento_dev`.

## Como rodar

Pasta por pasta, de cima pra baixo (**0. Health** → **1. Auth** →
**2. Users** → **3. Companies** → **4. Jobs**), clicando **Send** em cada requisição na
ordem em que aparecem. Cada uma já tem um teste embutido (aba **Test
Results**) que confere o status esperado e, quando relevante, o corpo da
resposta — e salva tokens/ids automaticamente pra próxima requisição
usar, sem precisar copiar nada na mão.

Alternativa mais rápida: **Collection Runner** (botão direito na coleção
→ *Run*) roda tudo em sequência e mostra um resumo verde/vermelho no
final.

## O que cada pasta prova

- **0. Health** — API key é exigida em toda rota, sem exceção (decisão
  CE-1), inclusive na mais boba delas.
- **1. Auth** — registro/login/refresh/logout completos, e-mail
  duplicado vira `409`, senha errada vira `401`, DTO inválido vira `400`.
- **2. Users** — só quem tem `user:manage` desativa/reativa; um usuário
  desativado literalmente não consegue mais logar (`401`), e volta a
  conseguir depois de reativado — provado de ponta a ponta, não só pelo
  código de status da própria chamada de desativação.
- **3. Companies** — só ADMIN cria/edita/desativa empresa (RECRUITER só
  lê); CNPJ duplicado agora vem com `reason: "cnpj_duplicado"` no corpo
  (primeiro módulo com o formato de erro estruturado); o CEP usado
  (`01310-100`, Av. Paulista) é real e a consulta acontece de verdade
  contra o ViaCEP, sem mock — você vai ver o endereço vindo preenchido de
  verdade na resposta.
- **4. Jobs** — a vaga nasce `DRAFT` (invisível), só fica pública quando
  vira `OPEN`; tentar pular pra `FILLED` sem passar por `OPEN` é `400`
  (`reason: "invalid_status_transition"`), e tentar marcar `FILLED` sem
  ter preenchido todas as vagas é `409`
  (`reason: "job_not_fully_filled"`). O teste automatizado
  (`test/jobs.e2e-spec.ts`) cobre um cenário que esta coleção não cobre
  por simplicidade — dois recrutadores de empresas diferentes, provando
  que um nunca enxerga/edita a vaga do outro.

## Se algo der errado

- Todo `401` sem explicação costuma ser `apiKey` vazia ou errada no
  ambiente.
- Se `POST /auth/login` dos usuários do seed (`admin@recrutamento.test`
  etc.) falhar, confira se `seedPassword` no ambiente bate com o
  `SEED_USER_PASSWORD` que você usou ao rodar o seed (padrão: `Senha@123`).
- Rodar a coleção mais de uma vez é seguro — cada execução cria e-mails/
  CNPJs novos com timestamp, não colide com a anterior.
