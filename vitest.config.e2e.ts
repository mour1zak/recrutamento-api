import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    // Achado Qwen rodada 12 (contexto do K3): arquivos de e2e compartilham
    // o MESMO banco de teste. Por padrão o Vitest roda arquivos de teste
    // em paralelo (processos/threads diferentes) — o que é seguro pra
    // dados isolados por teste (companies/jobs/users com nome único por
    // `Date.now()`), mas quebra qualquer teste que dependa de um AGREGADO
    // global (ex.: "quantos ADMIN ativos existem no sistema inteiro"),
    // porque outro arquivo pode estar criando/desativando admins ao mesmo
    // tempo. `auth.e2e-spec.ts` já testa a trava de último admin com
    // exatamente esse tipo de contagem global — rodar arquivos em
    // paralelo tornava impossível testar a mesma classe de invariante em
    // `users.e2e-spec.ts` (K3) sem risco de interferência cruzada.
    fileParallelism: false,
  },
});
