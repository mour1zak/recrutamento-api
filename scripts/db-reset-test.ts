import { config as parseEnvFile } from 'dotenv';
import { spawnSync } from 'node:child_process';

// Achado crítico Qwen rodada 7: a versão anterior deste script era
// `dotenv run -f .env.test -- prisma migrate reset --force && ...`. O
// `dotenv run` NÃO sobrescreve variáveis já existentes no ambiente por
// padrão — então, se `DATABASE_URL` já estivesse exportada no shell (ex.:
// alguém seguindo o README §4.7, que instrui exatamente isso pra rodar
// `migrate deploy`/seed manualmente), o `--force` do `migrate reset`
// apagava QUALQUER banco apontado por essa variável, não o
// `recrutamento_test`. Provado por Qwen com um "banco canário": criou um
// banco separado, exportou `DATABASE_URL` apontando pra ele, e o script
// apagou o canário em vez do banco de teste.
//
// Correção: 1) construir o `env` do processo filho nós mesmos, com os
// valores de `.env.test` sempre por cima de qualquer coisa já exportada
// (o `--override` que faltava); 2) checar que o nome do banco alvo
// realmente contém "test" antes de rodar qualquer coisa destrutiva — um
// comando irreversível não pode ter o alvo decidido só por uma variável
// de ambiente que o nome do script contradiz.
const { parsed, error } = parseEnvFile({ path: '.env.test' });
if (error || !parsed?.DATABASE_URL) {
  console.error('Recusado: não foi possível ler DATABASE_URL de .env.test.');
  process.exit(1);
}

const targetUrl = new URL(parsed.DATABASE_URL);
const databaseName = targetUrl.pathname.replace(/^\//, '');
if (!/test/i.test(databaseName)) {
  console.error(
    `Recusado: o banco de ".env.test" ("${databaseName}") não contém "test" no nome — ` +
      'este script só deve apagar um banco de teste descartável (achado Qwen rodada 7).',
  );
  process.exit(1);
}

const childEnv = { ...process.env, ...parsed };
// `npx` no Windows é um `.cmd` — só roda via `shell: true` (confirmado:
// sem `shell`, `spawnSync('npx.cmd', [...])` falha com `EINVAL`). Passar
// `shell: true` **junto com um array de `args`** faz o Node avisar
// (DEP0190) que os argumentos não são escapados pelo shell — mas aqui
// eles são sempre literais fixos (nunca vêm de input externo). Passar o
// comando inteiro como uma única string (sem array de `args` separado)
// evita o aviso sem perder a proteção: não há nada externo pra escapar.
for (const command of ['npx prisma migrate reset --force', 'npx prisma db seed']) {
  console.log(`\n$ ${command}  (contra "${databaseName}")`);
  const result = spawnSync(command, { stdio: 'inherit', env: childEnv, shell: true });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
