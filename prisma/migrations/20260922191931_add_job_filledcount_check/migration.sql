-- Achado crítico Qwen rodada 12 (K1): sem esta CHECK, nada no banco impede
-- um estado impossível (filledCount > vacancies) caso alguma corrida
-- futura escape do código Prisma (ex.: um script de manutenção, uma
-- migration de dados, ou um bug ainda não encontrado). Registrada desde a
-- Fase 1 (Gate Fase 3) e nunca implementada até esta correção.
--
-- Com o mapeamento de SQLSTATE já existente desde a rodada 7
-- (`23514` -> `409` no GlobalExceptionFilter), essa CHECK disparando já
-- vira um `409` estruturado sozinha, sem código novo no filtro.
ALTER TABLE "Job" ADD CONSTRAINT "job_filledcount_within_vacancies"
  CHECK ("filledCount" <= "vacancies" AND "filledCount" >= 0);
