-- Achado real, pego por um teste automatizado (test/gate-fase3.e2e-spec.ts)
-- que a migration anterior (gate_fase3_updated_at_trigger_and_email_ci_index)
-- não tinha: `NEW."updatedAt" = CURRENT_TIMESTAMP;` atribui um `timestamptz`
-- a uma coluna `timestamp without time zone` — o Postgres faz o cast
-- implícito usando o TimeZone DA SESSÃO (`America/Sao_Paulo`, UTC-3 neste
-- ambiente), gravando a hora de parede LOCAL como se fosse ingênua.
--
-- O Prisma Client, por convenção própria, sempre escreve/lê colunas
-- `timestamp without time zone` como UTC ingênuo. Resultado medido: um
-- `Company` criado pelo Prisma e depois tocado pelo trigger ficava com
-- `updatedAt` ~3 horas ATRASADO em relação ao `createdAt` — o oposto do
-- que o trigger deveria fazer.
--
-- Correção: forçar a conversão explícita pra UTC antes de gravar, com o
-- mesmo idioma que o Prisma usa (`AT TIME ZONE 'UTC'` sobre um
-- `timestamptz` devolve o "wall clock" em UTC, ingênuo, do jeito certo
-- pra uma coluna sem fuso).
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW."updatedAt" = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
