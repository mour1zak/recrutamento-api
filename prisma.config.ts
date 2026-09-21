import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    // seed: configurado quando prisma/seed.ts existir (Fase 2/plano do
    // DeepSeek em PARECER-DEEPSEEK-FASE1.md §4) — Prisma 7 não tem mais
    // --skip-seed, então deixamos comentado até o script existir de fato.
    // seed: 'node --experimental-strip-types prisma/seed.ts',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
});
