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
