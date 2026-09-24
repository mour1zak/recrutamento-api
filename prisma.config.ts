import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    // tsx (não `node --experimental-strip-types`): o gerador do Prisma
    // emite imports internos com extensão .js apontando pra arquivos .ts
    // (resolução nodenext, correta para o build do Nest via tsc). O Node
    // puro não remapeia .js -> .ts sozinho; o tsx faz essa resolução do
    // jeito que o TypeScript espera.
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    // `process.env` direto com fallback (não o helper `env()`, que é
    // estrito e lança se a variável não existir): corrige achado da revisão
    // técnica (N5-a). `prisma generate` não toca o banco — só lê o
    // schema — e não deveria exigir `DATABASE_URL` de verdade. Só
    // comandos que realmente conectam (`migrate`, `db push`...) precisam
    // de um valor real, e falham nesse momento com um erro de conexão
    // claro, não com um erro de config confuso antes mesmo de tentar.
    url: process.env.DATABASE_URL ?? 'postgresql://placeholder:placeholder@localhost:5432/placeholder',
  },
});
