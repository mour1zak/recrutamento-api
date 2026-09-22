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
 * Terceiro módulo de domínio. `PATCH /candidates/me` é upsert (não existe
 * `POST` separado — o perfil nasce na primeira atualização). A parte mais
 * sensível é `GET /candidates/:userId`: payload completo pro dono e pro
 * ADMIN, reduzido pro recrutador cuja empresa só tem candidatura
 * `PENDING` do candidato, completo se já avançou, e `404` (nunca `403`)
 * pra qualquer outra combinação — inclusive candidato vendo o perfil de
 * outro candidato sem nenhuma relação.
 */
describe('CandidateProfile (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const apiKey = process.env.API_KEY!;
  const seedPassword = process.env.SEED_USER_PASSWORD ?? 'Senha@123';

  let adminToken: string;
  let recruiterToken: string;
  let candidateAToken: string;
  let candidateAId: number;
  let candidateBToken: string;
  let candidateBId: number;
  let jobId: number;
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

    const adminLogin = await request(app.getHttpServer()).post('/auth/login').set('x-api-key', apiKey).send({ email: 'admin@recrutamento.test', password: seedPassword });
    adminToken = adminLogin.body.accessToken;
    const adminUserId = adminLogin.body.user.id;

    const [company, recruiterRole, someHash] = await Promise.all([
      prisma.company.create({ data: { name: `Empresa CandidateProfile ${Date.now()}` } }),
      prisma.role.findUniqueOrThrow({ where: { name: SYSTEM_ROLES.RECRUITER } }),
      prisma.user.findFirstOrThrow({ where: { email: 'admin@recrutamento.test' }, omit: { password: false } }).then((u) => u.password),
    ]);
    cleanupCompanyIds.push(company.id);

    const recruiter = await prisma.user.create({
      data: { name: 'Recrutador CandidateProfile', email: `recrutador-cp-${Date.now()}@example.com`, password: someHash, roleId: recruiterRole.id, companyId: company.id },
    });
    cleanupUserIds.push(recruiter.id);

    const job = await prisma.job.create({
      data: { title: 'Vaga CandidateProfile', description: 'X', vacancies: 1, isRemote: true, companyId: company.id, createdById: adminUserId },
    });
    jobId = job.id;

    const recruiterLogin = await request(app.getHttpServer()).post('/auth/login').set('x-api-key', apiKey).send({ email: recruiter.email, password: seedPassword });
    recruiterToken = recruiterLogin.body.accessToken;

    const registerA = await request(app.getHttpServer())
      .post('/auth/register')
      .set('x-api-key', apiKey)
      .send({ name: 'Candidato A', email: `candidato-a-cp-${Date.now()}@example.com`, password: 'SenhaForte@123' });
    candidateAToken = registerA.body.accessToken;
    candidateAId = registerA.body.user.id;
    cleanupUserIds.push(candidateAId);

    const registerB = await request(app.getHttpServer())
      .post('/auth/register')
      .set('x-api-key', apiKey)
      .send({ name: 'Candidato B', email: `candidato-b-cp-${Date.now()}@example.com`, password: 'SenhaForte@123' });
    candidateBToken = registerB.body.accessToken;
    candidateBId = registerB.body.user.id;
    cleanupUserIds.push(candidateBId);
  });

  afterAll(async () => {
    await prisma.application.deleteMany({ where: { jobId } });
    await prisma.refreshToken.deleteMany({ where: { userId: { in: cleanupUserIds } } });
    await prisma.candidateProfile.deleteMany({ where: { userId: { in: cleanupUserIds } } });
    await prisma.job.deleteMany({ where: { companyId: { in: cleanupCompanyIds } } });
    await prisma.user.deleteMany({ where: { id: { in: cleanupUserIds } } });
    await prisma.company.deleteMany({ where: { id: { in: cleanupCompanyIds } } });
    await app.close();
  });

  it('GET /candidates/me sem perfil ainda -> 404', () => {
    return request(app.getHttpServer())
      .get('/candidates/me')
      .set('x-api-key', apiKey)
      .set('Authorization', `Bearer ${candidateAToken}`)
      .expect(404);
  });

  it('PATCH /candidates/me como RECRUITER -> 403 (permission é só do candidato)', () => {
    return request(app.getHttpServer())
      .patch('/candidates/me')
      .set('x-api-key', apiKey)
      .set('Authorization', `Bearer ${recruiterToken}`)
      .send({ headline: 'X' })
      .expect(403);
  });

  it('PATCH /candidates/me cria o perfil (upsert) -> 200', async () => {
    const res = await request(app.getHttpServer())
      .patch('/candidates/me')
      .set('x-api-key', apiKey)
      .set('Authorization', `Bearer ${candidateAToken}`)
      .send({ headline: 'Dev Backend', summary: 'Experiência com NestJS', phone: '11999999999', skills: ['NestJS', 'Postgres'] })
      .expect(200);
    expect(res.body.headline).toBe('Dev Backend');
    expect(res.body.skills).toEqual(['NestJS', 'Postgres']);
    expect(res.body.name).toBe('Candidato A');
  });

  it('GET /candidates/me agora -> 200, mesmo conteúdo', async () => {
    const res = await request(app.getHttpServer())
      .get('/candidates/me')
      .set('x-api-key', apiKey)
      .set('Authorization', `Bearer ${candidateAToken}`)
      .expect(200);
    expect(res.body.headline).toBe('Dev Backend');
  });

  it('GET /candidates/:userId como o próprio candidato -> 200 completo', async () => {
    const res = await request(app.getHttpServer())
      .get(`/candidates/${candidateAId}`)
      .set('x-api-key', apiKey)
      .set('Authorization', `Bearer ${candidateAToken}`)
      .expect(200);
    expect(res.body.summary).toBe('Experiência com NestJS');
  });

  it('GET /candidates/:userId como ADMIN -> 200 completo', () => {
    return request(app.getHttpServer())
      .get(`/candidates/${candidateAId}`)
      .set('x-api-key', apiKey)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200)
      .expect((res) => {
        if (res.body.summary !== 'Experiência com NestJS') throw new Error('esperava perfil completo pro ADMIN');
      });
  });

  it('GET /candidates/:userId de um usuário que não é candidato (id do admin) -> 404', async () => {
    const adminLogin = await request(app.getHttpServer()).post('/auth/login').set('x-api-key', apiKey).send({ email: 'admin@recrutamento.test', password: seedPassword });
    return request(app.getHttpServer())
      .get(`/candidates/${adminLogin.body.user.id}`)
      .set('x-api-key', apiKey)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(404);
  });

  it('GET /candidates/:userId como CANDIDATE B (sem nenhuma relação com A) -> 404', () => {
    return request(app.getHttpServer())
      .get(`/candidates/${candidateAId}`)
      .set('x-api-key', apiKey)
      .set('Authorization', `Bearer ${candidateBToken}`)
      .expect(404);
  });

  describe('visibilidade condicional pro RECRUITER, baseada na candidatura', () => {
    it('RECRUITER sem nenhuma candidatura do candidato -> 404', () => {
      return request(app.getHttpServer())
        .get(`/candidates/${candidateAId}`)
        .set('x-api-key', apiKey)
        .set('Authorization', `Bearer ${recruiterToken}`)
        .expect(404);
    });

    it('candidatura PENDING -> RECRUITER vê perfil REDUZIDO (sem summary/phone)', async () => {
      await prisma.application.create({ data: { jobId, candidateId: candidateAId, status: 'PENDING' } });

      const res = await request(app.getHttpServer())
        .get(`/candidates/${candidateAId}`)
        .set('x-api-key', apiKey)
        .set('Authorization', `Bearer ${recruiterToken}`)
        .expect(200);
      expect(res.body.headline).toBe('Dev Backend');
      expect(res.body.skills).toEqual(['NestJS', 'Postgres']);
      expect(res.body.summary).toBeUndefined();
      expect(res.body.phone).toBeUndefined();
    });

    it('candidatura avança pra UNDER_REVIEW -> RECRUITER vê perfil COMPLETO', async () => {
      await prisma.application.updateMany({ where: { jobId, candidateId: candidateAId }, data: { status: 'UNDER_REVIEW' } });

      const res = await request(app.getHttpServer())
        .get(`/candidates/${candidateAId}`)
        .set('x-api-key', apiKey)
        .set('Authorization', `Bearer ${recruiterToken}`)
        .expect(200);
      expect(res.body.summary).toBe('Experiência com NestJS');
      expect(res.body.phone).toBe('11999999999');
    });
  });

  it('PATCH /candidates/me com CEP real (sem mock) enriquece o endereço', async () => {
    const res = await request(app.getHttpServer())
      .patch('/candidates/me')
      .set('x-api-key', apiKey)
      .set('Authorization', `Bearer ${candidateAToken}`)
      .send({ cep: '01310-100' })
      .expect(200);
    expect(res.body.city).toBe('São Paulo');
  });
});
