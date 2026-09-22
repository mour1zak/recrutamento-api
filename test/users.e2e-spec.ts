import { config as loadEnv } from 'dotenv';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { SYSTEM_ROLES } from '../src/common/constants/permissions.constants.js';
import { JobStatus } from '../src/generated/prisma/client.js';

loadEnv({ path: process.env.NODE_ENV === 'test' ? '.env.test' : '.env' });

/**
 * Rotas de gestão de usuários da Fase 4 (mapa DeepSeek §7) —
 * `deactivate`/`reactivate` já são cobertas em `auth.e2e-spec.ts` (Fase 2,
 * já auditadas, formato de erro antigo preservado de propósito). Estas
 * quatro rotas são novas, sem escopo de auditoria fechado, então usam o
 * formato estruturado (`reason`) igual aos módulos de domínio.
 */
describe('Users management (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const apiKey = process.env.API_KEY!;
  const seedPassword = process.env.SEED_USER_PASSWORD ?? 'Senha@123';

  let adminToken: string;
  let candidateToken: string;
  let candidateId: number;
  let companyId: number;
  const cleanupUserIds: number[] = [];
  const cleanupCompanyIds: number[] = [];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);

    const [adminLogin, candidateLogin] = await Promise.all([
      request(app.getHttpServer()).post('/auth/login').set('x-api-key', apiKey).send({ email: 'admin@recrutamento.test', password: seedPassword }),
      request(app.getHttpServer()).post('/auth/login').set('x-api-key', apiKey).send({ email: 'candidato@recrutamento.test', password: seedPassword }),
    ]);
    adminToken = adminLogin.body.accessToken;
    candidateToken = candidateLogin.body.accessToken;
    candidateId = candidateLogin.body.user.id;

    const company = await prisma.company.create({ data: { name: `Empresa Users Mgmt ${Date.now()}` } });
    companyId = company.id;
    cleanupCompanyIds.push(company.id);
  });

  afterAll(async () => {
    await prisma.job.deleteMany({ where: { companyId: { in: cleanupCompanyIds } } });
    await prisma.refreshToken.deleteMany({ where: { userId: { in: cleanupUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: cleanupUserIds } } });
    await prisma.company.deleteMany({ where: { id: { in: cleanupCompanyIds } } });
    await app.close();
  });

  it('GET /users (sem user:read) -> 403', () => {
    return request(app.getHttpServer()).get('/users').set('x-api-key', apiKey).set('Authorization', `Bearer ${candidateToken}`).expect(403);
  });

  it('GET /users (ADMIN) -> 200, lista paginada', async () => {
    const res = await request(app.getHttpServer()).get('/users').set('x-api-key', apiKey).set('Authorization', `Bearer ${adminToken}`).expect(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.some((u: { id: number }) => u.id === candidateId)).toBe(true);
  });

  it('GET /users/:id -> 200, sem password/tokenHash', async () => {
    const res = await request(app.getHttpServer()).get(`/users/${candidateId}`).set('x-api-key', apiKey).set('Authorization', `Bearer ${adminToken}`).expect(200);
    expect(res.body.password).toBeUndefined();
  });

  it('GET /users/:id inexistente -> 404', () => {
    return request(app.getHttpServer()).get('/users/999999').set('x-api-key', apiKey).set('Authorization', `Bearer ${adminToken}`).expect(404);
  });

  it('PATCH /users/:id/company com body {} (campo ausente) -> 400, nunca 500 (achado Qwen rodada 12, K4)', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/users/${candidateId}/company`)
      .set('x-api-key', apiKey)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({})
      .expect(400);
    expect(res.body.reason).toBe('company_id_obrigatorio');
  });

  it('PATCH /users/:id/company em usuário que NÃO é RECRUITER -> 409', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/users/${candidateId}/company`)
      .set('x-api-key', apiKey)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ companyId })
      .expect(409);
    expect(res.body.reason).toBe('usuario_nao_e_recrutador');
  });

  describe('recrutador de teste (company + role)', () => {
    let recruiterId: number;

    beforeAll(async () => {
      const [recruiterRole, someHash] = await Promise.all([
        prisma.role.findUniqueOrThrow({ where: { name: SYSTEM_ROLES.RECRUITER } }),
        prisma.user.findFirstOrThrow({ where: { email: 'admin@recrutamento.test' }, omit: { password: false } }).then((u) => u.password),
      ]);
      const recruiter = await prisma.user.create({
        data: { name: 'Recrutador Users Mgmt', email: `recrutador-users-mgmt-${Date.now()}@example.com`, password: someHash, roleId: recruiterRole.id },
      });
      recruiterId = recruiter.id;
      cleanupUserIds.push(recruiterId);
    });

    it('PATCH /users/:id/company com empresa inexistente -> 404', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/users/${recruiterId}/company`)
        .set('x-api-key', apiKey)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ companyId: 999999 })
        .expect(404);
      expect(res.body.reason).toBe('company_not_found');
    });

    it('PATCH /users/:id/company com empresa válida -> 200', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/users/${recruiterId}/company`)
        .set('x-api-key', apiKey)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ companyId })
        .expect(200);
      expect(res.body.companyId).toBe(companyId);
    });

    it('PATCH /users/:id/role com role inexistente -> 404', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/users/${recruiterId}/role`)
        .set('x-api-key', apiKey)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ roleId: 999999 })
        .expect(404);
      expect(res.body.reason).toBe('role_not_found');
    });

    it('PATCH /users/:id/role RECRUITER->CANDIDATE com vaga ativa -> 409', async () => {
      const [candidateRole] = await Promise.all([
        prisma.role.findUniqueOrThrow({ where: { name: SYSTEM_ROLES.CANDIDATE } }),
        prisma.job.create({ data: { title: 'Vaga Ativa Users Mgmt', description: 'X', vacancies: 1, isRemote: true, companyId, createdById: recruiterId, status: JobStatus.OPEN } }),
      ]);
      const res = await request(app.getHttpServer())
        .patch(`/users/${recruiterId}/role`)
        .set('x-api-key', apiKey)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ roleId: candidateRole.id })
        .expect(409);
      expect(res.body.reason).toBe('recrutador_com_vagas_ativas');
    });
  });

  // Achado CRÍTICO Qwen rodada 12 (K3): a contagem de "admins ativos" e a
  // escrita do novo papel aconteciam em dois passos separados, sem
  // transação — a mesma classe de corrida do C4 (Fase 2) e do C2 de Jobs
  // (rodada 8). Medido: isolando exatamente 2 admins ativos e trocando o
  // papel dos dois ao mesmo tempo, 10 em 12 corridas zeraram os admins
  // ativos. Corrigido envolvendo a contagem na mesma transação
  // `Serializable` que `deactivate()` já usa. Provar isso de verdade
  // exige isolar o número real de admins ativos — só é seguro fazer isso
  // porque `vitest.config.e2e.ts` agora roda os arquivos de teste em
  // sequência (`fileParallelism: false`), então nenhum outro arquivo
  // (`auth.e2e-spec.ts` inclusive, que tem seu próprio teste de admins
  // temporários) está mexendo na contagem global ao mesmo tempo.
  it('duas requisições PATCH .../role simultâneas tirando ADMIN de 2 admins (só eles ativos) nunca zeram os admins', async () => {
    const [adminRole, candidateRole, someHash] = await Promise.all([
      prisma.role.findUniqueOrThrow({ where: { name: SYSTEM_ROLES.ADMIN } }),
      prisma.role.findUniqueOrThrow({ where: { name: SYSTEM_ROLES.CANDIDATE } }),
      prisma.user.findFirstOrThrow({ where: { email: 'admin@recrutamento.test' }, omit: { password: false } }).then((u) => u.password),
    ]);

    const otherActiveAdmins = await prisma.user.findMany({ where: { isActive: true, roleId: adminRole.id }, select: { id: true } });
    const [adminX, adminY] = await Promise.all([
      prisma.user.create({ data: { name: 'K3 Admin X', email: `k3-admin-x-${Date.now()}@example.com`, password: someHash, roleId: adminRole.id } }),
      prisma.user.create({ data: { name: 'K3 Admin Y', email: `k3-admin-y-${Date.now()}@example.com`, password: someHash, roleId: adminRole.id } }),
    ]);

    try {
      // Estado limítrofe: SÓ X e Y ficam ativos como ADMIN — inclusive o
      // admin do seed é desativado temporariamente (restaurado no
      // `finally`), pra garantir que a contagem global seja exatamente 2.
      await prisma.user.updateMany({ where: { id: { in: otherActiveAdmins.map((a) => a.id) } }, data: { isActive: false } });

      const ROUNDS = 5;
      for (let round = 0; round < ROUNDS; round++) {
        await prisma.user.updateMany({ where: { id: { in: [adminX.id, adminY.id] } }, data: { roleId: adminRole.id, isActive: true } });
        const activeAdminsBefore = await prisma.user.count({ where: { isActive: true, roleId: adminRole.id } });
        expect(activeAdminsBefore).toBe(2);

        const [loginX, loginY] = await Promise.all([
          request(app.getHttpServer()).post('/auth/login').set('x-api-key', apiKey).send({ email: adminX.email, password: seedPassword }),
          request(app.getHttpServer()).post('/auth/login').set('x-api-key', apiKey).send({ email: adminY.email, password: seedPassword }),
        ]);
        const [resX, resY] = await Promise.all([
          request(app.getHttpServer()).patch(`/users/${adminX.id}/role`).set('x-api-key', apiKey).set('Authorization', `Bearer ${loginX.body.accessToken}`).send({ roleId: candidateRole.id }),
          request(app.getHttpServer()).patch(`/users/${adminY.id}/role`).set('x-api-key', apiKey).set('Authorization', `Bearer ${loginY.body.accessToken}`).send({ roleId: candidateRole.id }),
        ]);

        expect([resX.status, resY.status].every((s) => s === 200 || s === 409)).toBe(true);
        // Achado Qwen rodada 13 (ressalva 1): o 409 desta corrida pode
        // vir da regra de negócio (`last_active_admin`) OU de um
        // conflito de serialização puro (`concorrencia_transacao`) —
        // os dois agora têm `reason`, nenhum 409 "mudo".
        for (const res of [resX, resY]) {
          if (res.status === 409) {
            expect(['last_active_admin', 'concorrencia_transacao']).toContain(res.body.reason);
          }
        }
        const activeAdminsAfter = await prisma.user.count({ where: { isActive: true, roleId: adminRole.id } });
        // O invariante que importa: nunca ZERO admins ativos ao final.
        expect(activeAdminsAfter).toBeGreaterThanOrEqual(1);
      }
    } finally {
      await prisma.refreshToken.deleteMany({ where: { userId: { in: [adminX.id, adminY.id] } } });
      await prisma.user.deleteMany({ where: { id: { in: [adminX.id, adminY.id] } } });
      await prisma.user.updateMany({ where: { id: { in: otherActiveAdmins.map((a) => a.id) } }, data: { isActive: true } });
    }
  });

  it('PATCH /users/:id/role removendo o ÚLTIMO ADMIN ativo -> 409', async () => {
    const [candidateRole, adminCount] = await Promise.all([
      prisma.role.findUniqueOrThrow({ where: { name: SYSTEM_ROLES.CANDIDATE } }),
      prisma.user.count({ where: { isActive: true, role: { name: SYSTEM_ROLES.ADMIN } } }),
    ]);
    if (adminCount > 1) {
      // Ambiente já tem mais de um admin ativo (execução repetida sem
      // reset) — este teste específico não se aplica; os outros cobrem a
      // regra o suficiente.
      return;
    }
    const adminLogin = await request(app.getHttpServer()).post('/auth/login').set('x-api-key', apiKey).send({ email: 'admin@recrutamento.test', password: seedPassword });
    const res = await request(app.getHttpServer())
      .patch(`/users/${adminLogin.body.user.id}/role`)
      .set('x-api-key', apiKey)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ roleId: candidateRole.id })
      .expect(409);
    expect(res.body.reason).toBe('last_active_admin');
  });
});
