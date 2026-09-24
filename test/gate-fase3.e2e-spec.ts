import { config as loadEnv } from 'dotenv';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { SYSTEM_ROLES } from '../src/common/constants/permissions.constants.js';

loadEnv({ path: process.env.NODE_ENV === 'test' ? '.env.test' : '.env' });

/**
 * Gate Fase 3 (concorrência) — dois itens que só fazem sentido testar
 * contra o BANCO diretamente, não pela API: protegem contra SQL bruto
 * que contorna a normalização/timestamps da aplicação (achado Qwen
 * rodada 4, R13, e a lacuna de `updatedAt` exposta pelo próprio
 * `$queryRaw` de `hireWithCapacityCheck`). Testar via API não exercitaria
 * a proteção nova — a aplicação já normaliza email antes de qualquer
 * escrita normal.
 */
describe('Gate Fase 3 — proteções de banco (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let candidateRoleId: number;
  const cleanupUserIds: number[] = [];
  const cleanupCompanyIds: number[] = [];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);

    const candidateRole = await prisma.role.findUniqueOrThrow({ where: { name: SYSTEM_ROLES.CANDIDATE } });
    candidateRoleId = candidateRole.id;
  });

  afterAll(async () => {
    await prisma.job.deleteMany({ where: { companyId: { in: cleanupCompanyIds } } });
    await prisma.company.deleteMany({ where: { id: { in: cleanupCompanyIds } } });
    await prisma.refreshToken.deleteMany({ where: { userId: { in: cleanupUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: cleanupUserIds } } });
    await app.close();
  });

  it('índice único case-insensitive rejeita duplicata de email mesmo via SQL bruto (acha Qwen rodada 4, R13)', async () => {
    const email = `gate-fase3-${Date.now()}@example.com`;
    const user = await prisma.user.create({ data: { name: 'Gate Fase 3', email, password: 'x', roleId: candidateRoleId } });
    cleanupUserIds.push(user.id);

    const variant = email.toUpperCase();
    await expect(
      prisma.$executeRaw`INSERT INTO "User" (name, email, password, "roleId", "isActive", "createdAt", "updatedAt") VALUES ('dup', ${variant}, 'x', ${candidateRoleId}, true, now(), now())`,
    ).rejects.toThrow(/User_email_lower_key|unique constraint/i);
  });

  it('trigger de banco atualiza updatedAt mesmo em UPDATE via SQL bruto que não o menciona', async () => {
    const company = await prisma.company.create({ data: { name: `Gate Fase 3 Trigger ${Date.now()}` } });
    cleanupCompanyIds.push(company.id);
    const before = company.updatedAt.getTime();

    // Sem o trigger (achado ao fechar o Gate Fase 3: `updatedAt` não tem
    // `DEFAULT`/`ON UPDATE` nenhum — só o Prisma Client seta o valor em
    // todo `create`/`update` que ELE emite), este `UPDATE` via SQL bruto
    // deixaria `updatedAt` idêntico ao valor da criação, mesmo alterando
    // a linha. Um pequeno atraso real garante uma diferença de timestamp
    // mensurável (coluna tem precisão de milissegundos).
    await new Promise((resolve) => setTimeout(resolve, 50));
    await prisma.$executeRaw`UPDATE "Company" SET name = name WHERE id = ${company.id}`;
    const after = await prisma.company.findUniqueOrThrow({ where: { id: company.id } });

    expect(after.updatedAt.getTime()).toBeGreaterThan(before);
  });

  it('CHECK do banco rejeita filledCount > vacancies com SQLSTATE identificável, que o GlobalExceptionFilter já mapeia pra 409', async () => {
    const adminUser = await prisma.user.findFirstOrThrow({ where: { role: { name: SYSTEM_ROLES.ADMIN } } });
    const company = await prisma.company.create({ data: { name: `Gate Fase 3 CHECK ${Date.now()}` } });
    cleanupCompanyIds.push(company.id);
    const job = await prisma.job.create({
      data: { title: 'Vaga Gate Fase 3', description: 'X', vacancies: 1, companyId: company.id, createdById: adminUser.id },
    });

    let caught: { meta?: { driverAdapterError?: { cause?: { originalCode?: string } } } } | undefined;
    try {
      // Via Prisma Client, não SQL bruto: prova que a CHECK protege até
      // uma escrita "normal" que, por algum bug futuro, tentasse gravar
      // um estado impossível diretamente.
      await prisma.job.update({ where: { id: job.id }, data: { filledCount: 5 } });
    } catch (error) {
      caught = error as typeof caught;
    }

    expect(caught).toBeDefined();
    // 23514 = check_violation (SQLSTATE do Postgres) — o mesmo código que
    // `SQLSTATE_CONFLICT` em `global-exception.filter.ts` mapeia pra
    // `409` desde a rodada 7, antes mesmo desta CHECK existir na
    // migration (adiantado pelo Qwen).
    expect(caught?.meta?.driverAdapterError?.cause?.originalCode).toBe('23514');
  });
});
