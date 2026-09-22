import { config as loadEnv } from 'dotenv';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { SYSTEM_ROLES } from '../src/common/constants/permissions.constants.js';

loadEnv({ path: process.env.NODE_ENV === 'test' ? '.env.test' : '.env' });

/**
 * Segundo módulo de domínio. Cobre a regra obrigatória do enunciado
 * "recruiter só opera vagas da própria empresa" — testada com DUAS
 * empresas e DOIS recrutadores distintos (criados direto via Prisma,
 * reaproveitando o hash de senha do seed, mesmo padrão já usado no
 * teste de concorrência de `auth.e2e-spec.ts`), a visibilidade
 * condicional por status (OPEN é público, o resto só pra quem é dono),
 * e as duas invariantes de `vacancies`/`filledCount`.
 */
describe('Jobs (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const apiKey = process.env.API_KEY!;
  const seedPassword = process.env.SEED_USER_PASSWORD ?? 'Senha@123';

  let adminToken: string;
  let candidateToken: string;
  let recruiterAToken: string;
  let recruiterBToken: string;
  let companyAId: number;
  let companyBId: number;
  const cleanupUserIds: number[] = [];
  const cleanupCompanyIds: number[] = [];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();

    prisma = app.get(PrismaService);

    const [adminLogin, candidateLogin, recruiterRole, seedRecruiter] = await Promise.all([
      request(app.getHttpServer()).post('/auth/login').set('x-api-key', apiKey).send({ email: 'admin@recrutamento.test', password: seedPassword }),
      request(app.getHttpServer()).post('/auth/login').set('x-api-key', apiKey).send({ email: 'candidato@recrutamento.test', password: seedPassword }),
      prisma.role.findUniqueOrThrow({ where: { name: SYSTEM_ROLES.RECRUITER } }),
      // `omit: { password: false }`: override pontual do `omit` global do
      // PrismaService (mesmo padrão de `findByEmailForLogin` em
      // users.service.ts) — aqui é só pra reaproveitar o hash já
      // calculado do seed, sem rehashear.
      prisma.user.findFirstOrThrow({ where: { email: 'recrutador@recrutamento.test' }, omit: { password: false } }),
    ]);
    adminToken = adminLogin.body.accessToken;
    candidateToken = candidateLogin.body.accessToken;

    const [companyA, companyB] = await Promise.all([
      prisma.company.create({ data: { name: `Empresa A Jobs ${Date.now()}` } }),
      prisma.company.create({ data: { name: `Empresa B Jobs ${Date.now()}` } }),
    ]);
    companyAId = companyA.id;
    companyBId = companyB.id;
    cleanupCompanyIds.push(companyA.id, companyB.id);

    const [recruiterA, recruiterB] = await Promise.all([
      prisma.user.create({
        data: { name: 'Recrutador A', email: `recrutador-a-${Date.now()}@example.com`, password: seedRecruiter.password, roleId: recruiterRole.id, companyId: companyA.id },
      }),
      prisma.user.create({
        data: { name: 'Recrutador B', email: `recrutador-b-${Date.now()}@example.com`, password: seedRecruiter.password, roleId: recruiterRole.id, companyId: companyB.id },
      }),
    ]);
    cleanupUserIds.push(recruiterA.id, recruiterB.id);

    const [loginA, loginB] = await Promise.all([
      request(app.getHttpServer()).post('/auth/login').set('x-api-key', apiKey).send({ email: recruiterA.email, password: seedPassword }),
      request(app.getHttpServer()).post('/auth/login').set('x-api-key', apiKey).send({ email: recruiterB.email, password: seedPassword }),
    ]);
    recruiterAToken = loginA.body.accessToken;
    recruiterBToken = loginB.body.accessToken;
  });

  afterAll(async () => {
    await prisma.refreshToken.deleteMany({ where: { userId: { in: cleanupUserIds } } });
    await prisma.job.deleteMany({ where: { companyId: { in: cleanupCompanyIds } } });
    await prisma.user.deleteMany({ where: { id: { in: cleanupUserIds } } });
    await prisma.company.deleteMany({ where: { id: { in: cleanupCompanyIds } } });
    await app.close();
  });

  it('GET /jobs (público, só API key, sem JWT) -> 200', () => {
    return request(app.getHttpServer()).get('/jobs').set('x-api-key', apiKey).expect(200).expect((res) => {
      if (!Array.isArray(res.body.data)) throw new Error('esperava { data: [] }');
    });
  });

  it('POST /jobs como CANDIDATE -> 403', () => {
    return request(app.getHttpServer())
      .post('/jobs')
      .set('x-api-key', apiKey)
      .set('Authorization', `Bearer ${candidateToken}`)
      .send({ title: 'X', description: 'X', vacancies: 1, isRemote: true })
      .expect(403);
  });

  it('POST /jobs como ADMIN sem companyId -> 400', () => {
    return request(app.getHttpServer())
      .post('/jobs')
      .set('x-api-key', apiKey)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ title: 'Vaga sem empresa', description: 'X', vacancies: 1, isRemote: true })
      .expect(400);
  });

  describe('recrutador A cria e gerencia uma vaga; recrutador B (outra empresa) nunca acessa', () => {
    let jobId: number;

    it('POST /jobs como recruiterA sem companyId no body -> 201, usa a própria empresa', async () => {
      const res = await request(app.getHttpServer())
        .post('/jobs')
        .set('x-api-key', apiKey)
        .set('Authorization', `Bearer ${recruiterAToken}`)
        .send({ title: 'Dev Backend', description: 'Vaga de teste', vacancies: 1, isRemote: true })
        .expect(201);
      jobId = res.body.id;
      expect(res.body.companyId).toBe(companyAId);
      expect(res.body.status).toBe('DRAFT');
    });

    it('POST /jobs como recruiterA com companyId da empresa B -> 404 (empresa de terceiro)', () => {
      return request(app.getHttpServer())
        .post('/jobs')
        .set('x-api-key', apiKey)
        .set('Authorization', `Bearer ${recruiterAToken}`)
        .send({ title: 'X', description: 'X', vacancies: 1, isRemote: true, companyId: companyBId })
        .expect(404);
    });

    it('GET /jobs/:id (DRAFT) como CANDIDATE -> 404 (não é público, candidate não tem job:read:any)', () => {
      return request(app.getHttpServer())
        .get(`/jobs/${jobId}`)
        .set('x-api-key', apiKey)
        .set('Authorization', `Bearer ${candidateToken}`)
        .expect(404);
    });

    it('GET /jobs/:id (DRAFT) como recruiterB (outra empresa) -> 404', () => {
      return request(app.getHttpServer())
        .get(`/jobs/${jobId}`)
        .set('x-api-key', apiKey)
        .set('Authorization', `Bearer ${recruiterBToken}`)
        .expect(404);
    });

    it('GET /jobs/:id (DRAFT) como recruiterA (dono) -> 200', () => {
      return request(app.getHttpServer())
        .get(`/jobs/${jobId}`)
        .set('x-api-key', apiKey)
        .set('Authorization', `Bearer ${recruiterAToken}`)
        .expect(200);
    });

    it('PATCH /jobs/:id/status como recruiterB (outra empresa) -> 404', () => {
      return request(app.getHttpServer())
        .patch(`/jobs/${jobId}/status`)
        .set('x-api-key', apiKey)
        .set('Authorization', `Bearer ${recruiterBToken}`)
        .send({ status: 'OPEN' })
        .expect(404);
    });

    it('PATCH /jobs/:id/status DRAFT -> FILLED (transição inválida) -> 400', () => {
      return request(app.getHttpServer())
        .patch(`/jobs/${jobId}/status`)
        .set('x-api-key', apiKey)
        .set('Authorization', `Bearer ${recruiterAToken}`)
        .send({ status: 'FILLED' })
        .expect(400);
    });

    it('PATCH /jobs/:id/status DRAFT -> OPEN -> 200', () => {
      return request(app.getHttpServer())
        .patch(`/jobs/${jobId}/status`)
        .set('x-api-key', apiKey)
        .set('Authorization', `Bearer ${recruiterAToken}`)
        .send({ status: 'OPEN' })
        .expect(200);
    });

    it('GET /jobs/:id agora OPEN, como CANDIDATE -> 200 (ficou público)', () => {
      return request(app.getHttpServer())
        .get(`/jobs/${jobId}`)
        .set('x-api-key', apiKey)
        .set('Authorization', `Bearer ${candidateToken}`)
        .expect(200);
    });

    it('GET /jobs (lista pública) agora inclui a vaga', async () => {
      const res = await request(app.getHttpServer()).get('/jobs?limit=100').set('x-api-key', apiKey).expect(200);
      expect(res.body.data.some((j: { id: number }) => j.id === jobId)).toBe(true);
    });

    it('PATCH /jobs/:id/status OPEN -> FILLED com filledCount < vacancies -> 409', () => {
      return request(app.getHttpServer())
        .patch(`/jobs/${jobId}/status`)
        .set('x-api-key', apiKey)
        .set('Authorization', `Bearer ${recruiterAToken}`)
        .send({ status: 'FILLED' })
        .expect(409);
    });

    it('PATCH /jobs/:id reduzindo vacancies abaixo do filledCount -> 409', async () => {
      // filledCount só é escrito pelo fluxo de contratação (Fase 3, ainda
      // não implementado) — simulado direto no banco pra testar a
      // invariante do Service isoladamente. `vacancies: 1` (não 0): o
      // DTO já barra 0 (`@Min(1)`, uma vaga sempre tem ao menos 1
      // posição) — o que este teste prova é a invariante de negócio
      // "não pode ficar abaixo do que já foi preenchido", não a validação
      // de forma do campo.
      await prisma.job.update({ where: { id: jobId }, data: { filledCount: 2 } });

      const res = await request(app.getHttpServer())
        .patch(`/jobs/${jobId}`)
        .set('x-api-key', apiKey)
        .set('Authorization', `Bearer ${recruiterAToken}`)
        .send({ vacancies: 1 })
        .expect(409);
      expect(res.body.reason).toBe('vacancies_below_filled_count');

      await prisma.job.update({ where: { id: jobId }, data: { filledCount: 0 } });
    });

    it('GET /jobs/mine como recruiterA -> inclui a vaga da empresa A', async () => {
      const res = await request(app.getHttpServer())
        .get('/jobs/mine')
        .set('x-api-key', apiKey)
        .set('Authorization', `Bearer ${recruiterAToken}`)
        .expect(200);
      expect(res.body.data.some((j: { id: number }) => j.id === jobId)).toBe(true);
    });

    it('GET /jobs/mine como recruiterB -> NÃO inclui a vaga da empresa A', async () => {
      const res = await request(app.getHttpServer())
        .get('/jobs/mine')
        .set('x-api-key', apiKey)
        .set('Authorization', `Bearer ${recruiterBToken}`)
        .expect(200);
      expect(res.body.data.some((j: { id: number }) => j.id === jobId)).toBe(false);
    });
  });
});
