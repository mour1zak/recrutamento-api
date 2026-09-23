-- Gate Fase 3 (concorrência) — dois itens registrados desde a Fase 1 em
-- CONDICOES-ENTRADA-FASE2.md, ambos sobre proteger o banco de escritas
-- que não passam pelo Prisma Client (SQL bruto, que a Fase 3 já usa —
-- ver `ApplicationsService.hireWithCapacityCheck()`).

-- 1) `updatedAt` não tem DEFAULT nem trigger — é só o Prisma Client que
--    seta o valor em todo `create`/`update` que ELE emite. Um
--    `$executeRaw`/`$queryRaw` que escreve na tabela (como o `UPDATE
--    "Job" SET "filledCount" = ...` da contratação) não passa por esse
--    caminho e deixava `updatedAt` desatualizado. Trigger genérico
--    aplicado às 7 tabelas que têm a coluna — fecha a lacuna pra
--    qualquer SQL bruto futuro, não só o de hoje.
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW."updatedAt" = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['User', 'app_roles', 'CandidateProfile', 'Company', 'Job', 'Application', 'Interview']
  LOOP
    EXECUTE format(
      'CREATE TRIGGER set_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at();',
      t
    );
  END LOOP;
END $$;

-- 2) Índice único case-insensitive pra `User.email` (achado Qwen rodada
--    4, R13): a normalização (lowercase + trim) só existe na aplicação —
--    um INSERT via SQL bruto, ou um bug futuro, pode criar "A@x.com" ao
--    lado de "a@x.com". Índice funcional único fecha isso no banco,
--    além (não em vez) do `@@unique(email)` que o Prisma já gerencia.
CREATE UNIQUE INDEX "User_email_lower_key" ON "User" (LOWER("email"));
