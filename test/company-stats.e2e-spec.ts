import { config as loadEnv } from 'dotenv';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { SYSTEM_ROLES } from '../src/common/constants/permissions.constants.js';
import { JobStatus } from '../src/generated/prisma/client.js';

loadEnv({ path: process.env.NODE_ENV === 'test' ? '.env.test' : '.env' });

/**
 * `GET /companies/:id/stats` — bônus "indicadores do domínio" (métrica de
 * NEGÓCIO: vagas por status, funil de candidaturas, conversão, tempo
 * médio até contratação), diferente da observabilidade de infraestrutura
 * (Loki/Grafana, cobertos em `docs/fases/`). Progride candidaturas de
 * verdade pelas transições da API (não grava status direto no banco) pra
 * exercitar o mesmo caminho que gera `ApplicationStatusHistory`, de onde
 * o tempo médio até contratação é calculado.
 */
describe('Company stats / domain indicators (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const apiKey = process.env.API_KEY!;
  const seedPassword = process.env.SEED_USER_PASSWORD ?? 'Senha@123';

  let adminToken: string;
  let recruiterAToken: string;
  let recruiterBToken: string;
  let companyAId: number;
  let companyBId: number;
  const cleanupUserIds: number[] = [];
  const cleanupCompanyIds: number[] = [];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);

    const adminLogin = await request(app.getHttpServer()).post('/auth/login').set('x-api-key', apiKey).send({ email: 'admin@recrutamento.test', password: seedPassword });
    adminToken = adminLogin.body.accessToken;
    const adminUserId = adminLogin.body.user.id;

    const [companyA, companyB, recruiterRole, adminUser] = await Promise.all([
      prisma.company.create({ data: { name: `Empresa A Stats ${Date.now()}` } }),
      prisma.company.create({ data: { name: `Empresa B Stats ${Date.now()}` } }),
      prisma.role.findUniqueOrThrow({ where: { name: SYSTEM_ROLES.RECRUITER } }),
      prisma.user.findFirstOrThrow({ where: { email: 'admin@recrutamento.test' }, omit: { password: false } }),
    ]);
    companyAId = companyA.id;
    companyBId = companyB.id;
    cleanupCompanyIds.push(companyA.id, companyB.id);

    const [recruiterA, recruiterB] = await Promise.all([
      prisma.user.create({ data: { name: 'Recrutador A Stats', email: `recrutador-a-stats-${Date.now()}@example.com`, password: adminUser.password, roleId: recruiterRole.id, companyId: companyA.id } }),
      prisma.user.create({ data: { name: 'Recrutador B Stats', email: `recrutador-b-stats-${Date.now()}@example.com`, password: adminUser.password, roleId: recruiterRole.id, companyId: companyB.id } }),
    ]);
    cleanupUserIds.push(recruiterA.id, recruiterB.id);

    const [loginA, loginB] = await Promise.all([
      request(app.getHttpServer()).post('/auth/login').set('x-api-key', apiKey).send({ email: recruiterA.email, password: seedPassword }),
      request(app.getHttpServer()).post('/auth/login').set('x-api-key', apiKey).send({ email: recruiterB.email, password: seedPassword }),
    ]);
    recruiterAToken = loginA.body.accessToken;
    recruiterBToken = loginB.body.accessToken;

    const [jobOpen, jobDraft] = await Promise.all([
      prisma.job.create({ data: { title: 'Vaga Aberta Stats', description: 'X', vacancies: 2, isRemote: true, companyId: companyA.id, createdById: adminUserId, status: JobStatus.OPEN } }),
      prisma.job.create({ data: { title: 'Vaga Rascunho Stats', description: 'X', vacancies: 1, isRemote: true, companyId: companyA.id, createdById: adminUserId } }),
    ]);

    const [candidateHired, candidateRejected] = await Promise.all([
      request(app.getHttpServer()).post('/auth/register').set('x-api-key', apiKey).send({ name: 'Candidato Contratado Stats', email: `candidato-hired-stats-${Date.now()}@example.com`, password: 'SenhaForte@123' }),
      request(app.getHttpServer()).post('/auth/register').set('x-api-key', apiKey).send({ name: 'Candidato Rejeitado Stats', email: `candidato-rejected-stats-${Date.now()}@example.com`, password: 'SenhaForte@123' }),
    ]);
    cleanupUserIds.push(candidateHired.body.user.id, candidateRejected.body.user.id);

    const [appHiredRes, appRejectedRes] = await Promise.all([
      request(app.getHttpServer()).post(`/jobs/${jobOpen.id}/applications`).set('x-api-key', apiKey).set('Authorization', `Bearer ${candidateHired.body.accessToken}`).send({}),
      request(app.getHttpServer()).post(`/jobs/${jobOpen.id}/applications`).set('x-api-key', apiKey).set('Authorization', `Bearer ${candidateRejected.body.accessToken}`).send({}),
    ]);
    const appHiredId = appHiredRes.body.id;
    const appRejectedId = appRejectedRes.body.id;

    // Progride pelas transições reais da API — gera ApplicationStatusHistory
    // de verdade, de onde `avgTimeToHireDays` é calculado.
    for (const status of ['UNDER_REVIEW', 'INTERVIEW', 'OFFERED', 'HIRED']) {
      await request(app.getHttpServer()).patch(`/applications/${appHiredId}/status`).set('x-api-key', apiKey).set('Authorization', `Bearer ${recruiterAToken}`).send({ status }).expect(200);
    }
    await request(app.getHttpServer()).patch(`/applications/${appRejectedId}/status`).set('x-api-key', apiKey).set('Authorization', `Bearer ${recruiterAToken}`).send({ status: 'REJECTED' }).expect(200);

    void jobDraft;
  });

  afterAll(async () => {
    await prisma.applicationStatusHistory.deleteMany({ where: { application: { job: { companyId: { in: cleanupCompanyIds } } } } });
    await prisma.application.deleteMany({ where: { job: { companyId: { in: cleanupCompanyIds } } } });
    await prisma.job.deleteMany({ where: { companyId: { in: cleanupCompanyIds } } });
    await prisma.refreshToken.deleteMany({ where: { userId: { in: cleanupUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: cleanupUserIds } } });
    await prisma.company.deleteMany({ where: { id: { in: cleanupCompanyIds } } });
    await app.close();
  });

  it('RECRUITER da própria empresa -> 200, indicadores corretos', async () => {
    const res = await request(app.getHttpServer()).get(`/companies/${companyAId}/stats`).set('x-api-key', apiKey).set('Authorization', `Bearer ${recruiterAToken}`).expect(200);

    expect(res.body.jobs.total).toBe(2);
    expect(res.body.jobs.byStatus.OPEN).toBe(1);
    expect(res.body.jobs.byStatus.DRAFT).toBe(1);

    expect(res.body.applications.total).toBe(2);
    expect(res.body.applications.byStatus.HIRED).toBe(1);
    expect(res.body.applications.byStatus.REJECTED).toBe(1);
    expect(res.body.applications.conversionRate).toBe(0.5);
    expect(typeof res.body.applications.avgTimeToHireDays).toBe('number');
    expect(res.body.applications.avgTimeToHireDays).toBeGreaterThanOrEqual(0);
  });

  it('ADMIN -> 200, mesmos indicadores de qualquer empresa', async () => {
    const res = await request(app.getHttpServer()).get(`/companies/${companyAId}/stats`).set('x-api-key', apiKey).set('Authorization', `Bearer ${adminToken}`).expect(200);
    expect(res.body.applications.total).toBe(2);
  });

  it('RECRUITER de OUTRA empresa -> 404 (anti-enumeração, não 403)', () => {
    return request(app.getHttpServer()).get(`/companies/${companyAId}/stats`).set('x-api-key', apiKey).set('Authorization', `Bearer ${recruiterBToken}`).expect(404);
  });

  it('empresa sem nenhuma vaga/candidatura -> 200, contadores zerados e taxas null', async () => {
    const res = await request(app.getHttpServer()).get(`/companies/${companyBId}/stats`).set('x-api-key', apiKey).set('Authorization', `Bearer ${recruiterBToken}`).expect(200);
    expect(res.body.jobs.total).toBe(0);
    expect(res.body.applications.total).toBe(0);
    expect(res.body.applications.conversionRate).toBeNull();
    expect(res.body.applications.avgTimeToHireDays).toBeNull();
  });
});
