import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

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
    url: env('DATABASE_URL'),
  },
});
