import { config as loadEnv } from 'dotenv';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { SYSTEM_ROLES } from '../src/common/constants/permissions.constants.js';
import { ApplicationStatus, JobStatus } from '../src/generated/prisma/client.js';

loadEnv({ path: process.env.NODE_ENV === 'test' ? '.env.test' : '.env' });

/**
 * Quinto módulo de domínio. `PATCH /interviews/:id` com
 * `status: "RESCHEDULED"` é a rota mais incomum do mapa do DeepSeek: em
 * vez de editar a entrevista original, cria uma NOVA (histórico
 * preservado) e devolve `201`, não `200` — testado explicitamente.
 */
describe('Interviews (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const apiKey = process.env.API_KEY!;
  const seedPassword = process.env.SEED_USER_PASSWORD ?? 'Senha@123';

  let adminUserId: number;
  let recruiterAToken: string;
  let recruiterBToken: string;
  let candidateToken: string;
  let applicationInInterviewId: number;
  let applicationPendingId: number;
  let companyAId: number;
  const cleanupUserIds: number[] = [];
  const cleanupCompanyIds: number[] = [];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);

    const adminLogin = await request(app.getHttpServer()).post('/auth/login').set('x-api-key', apiKey).send({ email: 'admin@recrutamento.test', password: seedPassword });
    adminUserId = adminLogin.body.user.id;

    const [companyA, companyB, recruiterRole, someHash] = await Promise.all([
      prisma.company.create({ data: { name: `Empresa A Interviews ${Date.now()}` } }),
      prisma.company.create({ data: { name: `Empresa B Interviews ${Date.now()}` } }),
      prisma.role.findUniqueOrThrow({ where: { name: SYSTEM_ROLES.RECRUITER } }),
      prisma.user.findFirstOrThrow({ where: { email: 'admin@recrutamento.test' }, omit: { password: false } }).then((u) => u.password),
    ]);
    cleanupCompanyIds.push(companyA.id, companyB.id);
    companyAId = companyA.id;

    const [recruiterA, recruiterB] = await Promise.all([
      prisma.user.create({ data: { name: 'Recrutador A Interviews', email: `recrutador-a-interviews-${Date.now()}@example.com`, password: someHash, roleId: recruiterRole.id, companyId: companyA.id } }),
      prisma.user.create({ data: { name: 'Recrutador B Interviews', email: `recrutador-b-interviews-${Date.now()}@example.com`, password: someHash, roleId: recruiterRole.id, companyId: companyB.id } }),
    ]);
    cleanupUserIds.push(recruiterA.id, recruiterB.id);

    const [loginA, loginB] = await Promise.all([
      request(app.getHttpServer()).post('/auth/login').set('x-api-key', apiKey).send({ email: recruiterA.email, password: seedPassword }),
      request(app.getHttpServer()).post('/auth/login').set('x-api-key', apiKey).send({ email: recruiterB.email, password: seedPassword }),
    ]);
    recruiterAToken = loginA.body.accessToken;
    recruiterBToken = loginB.body.accessToken;

    const registerCandidate = await request(app.getHttpServer())
      .post('/auth/register')
      .set('x-api-key', apiKey)
      .send({ name: 'Candidato Interviews', email: `candidato-interviews-${Date.now()}@example.com`, password: 'SenhaForte@123' });
    const candidateId = registerCandidate.body.user.id;
    candidateToken = registerCandidate.body.accessToken;
    cleanupUserIds.push(candidateId);

    const [jobA1, jobA2] = await Promise.all([
      prisma.job.create({ data: { title: 'Vaga A1 Interviews', description: 'X', vacancies: 2, isRemote: true, companyId: companyA.id, createdById: adminUserId, status: JobStatus.OPEN } }),
      prisma.job.create({ data: { title: 'Vaga A2 Interviews', description: 'X', vacancies: 2, isRemote: true, companyId: companyA.id, createdById: adminUserId, status: JobStatus.OPEN } }),
    ]);

    const [appInInterview, appPending] = await Promise.all([
      prisma.application.create({ data: { jobId: jobA1.id, candidateId, status: ApplicationStatus.INTERVIEW } }),
      prisma.application.create({ data: { jobId: jobA2.id, candidateId, status: ApplicationStatus.PENDING } }),
    ]);
    applicationInInterviewId = appInInterview.id;
    applicationPendingId = appPending.id;
  });

  afterAll(async () => {
    await prisma.interview.deleteMany({ where: { application: { job: { companyId: { in: cleanupCompanyIds } } } } });
    await prisma.applicationStatusHistory.deleteMany({ where: { application: { job: { companyId: { in: cleanupCompanyIds } } } } });
    await prisma.application.deleteMany({ where: { job: { companyId: { in: cleanupCompanyIds } } } });
    await prisma.refreshToken.deleteMany({ where: { userId: { in: cleanupUserIds } } });
    await prisma.job.deleteMany({ where: { companyId: { in: cleanupCompanyIds } } });
    await prisma.user.deleteMany({ where: { id: { in: cleanupUserIds } } });
    await prisma.company.deleteMany({ where: { id: { in: cleanupCompanyIds } } });
    await app.close();
  });

  let interviewId: number;

  it('POST /applications/:id/interviews (candidatura em PENDING) -> 409', async () => {
    const res = await request(app.getHttpServer())
      .post(`/applications/${applicationPendingId}/interviews`)
      .set('x-api-key', apiKey)
      .set('Authorization', `Bearer ${recruiterAToken}`)
      .send({ scheduledAt: '2027-01-10T14:00:00.000Z' })
      .expect(409);
    expect(res.body.reason).toBe('application_not_in_interview_stage');
  });

  it('POST /applications/:id/interviews (recrutador de OUTRA empresa) -> 404', () => {
    return request(app.getHttpServer())
      .post(`/applications/${applicationInInterviewId}/interviews`)
      .set('x-api-key', apiKey)
      .set('Authorization', `Bearer ${recruiterBToken}`)
      .send({ scheduledAt: '2027-01-10T14:00:00.000Z' })
      .expect(404);
  });

  it('POST /applications/:id/interviews (candidatura em INTERVIEW) -> 201, status SCHEDULED', async () => {
    const res = await request(app.getHttpServer())
      .post(`/applications/${applicationInInterviewId}/interviews`)
      .set('x-api-key', apiKey)
      .set('Authorization', `Bearer ${recruiterAToken}`)
      .send({ scheduledAt: '2027-01-10T14:00:00.000Z' })
      .expect(201);
    expect(res.body.status).toBe('SCHEDULED');
    interviewId = res.body.id;
  });

  it('GET /applications/:id/interviews -> 200, lista a entrevista', async () => {
    const res = await request(app.getHttpServer())
      .get(`/applications/${applicationInInterviewId}/interviews`)
      .set('x-api-key', apiKey)
      .set('Authorization', `Bearer ${recruiterAToken}`)
      .expect(200);
    expect(res.body.some((i: { id: number }) => i.id === interviewId)).toBe(true);
  });

  it('GET /interviews/:id (recrutador de OUTRA empresa) -> 404', () => {
    return request(app.getHttpServer())
      .get(`/interviews/${interviewId}`)
      .set('x-api-key', apiKey)
      .set('Authorization', `Bearer ${recruiterBToken}`)
      .expect(404);
  });

  it('PATCH /interviews/:id status RESCHEDULED sem scheduledAt -> 400', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/interviews/${interviewId}`)
      .set('x-api-key', apiKey)
      .set('Authorization', `Bearer ${recruiterAToken}`)
      .send({ status: 'RESCHEDULED' })
      .expect(400);
    expect(res.body.reason).toBe('scheduled_at_obrigatorio');
  });

  let rescheduledInterviewId: number;

  it('PATCH /interviews/:id status RESCHEDULED -> 201 com a NOVA entrevista, original vira RESCHEDULED', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/interviews/${interviewId}`)
      .set('x-api-key', apiKey)
      .set('Authorization', `Bearer ${recruiterAToken}`)
      .send({ status: 'RESCHEDULED', scheduledAt: '2027-02-01T10:00:00.000Z' })
      .expect(201);
    expect(res.body.status).toBe('SCHEDULED');
    expect(res.body.previousInterviewId).toBe(interviewId);
    rescheduledInterviewId = res.body.id;

    const original = await prisma.interview.findUniqueOrThrow({ where: { id: interviewId } });
    expect(original.status).toBe('RESCHEDULED');
  });

  it('PATCH /interviews/:id em entrevista já RESCHEDULED (terminal) -> 409', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/interviews/${interviewId}`)
      .set('x-api-key', apiKey)
      .set('Authorization', `Bearer ${recruiterAToken}`)
      .send({ feedback: 'tentando editar depois de encerrada' })
      .expect(409);
    expect(res.body.reason).toBe('interview_ja_encerrada');
  });

  it('PATCH /interviews/:id (nova entrevista) status COMPLETED + feedback -> 200', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/interviews/${rescheduledInterviewId}`)
      .set('x-api-key', apiKey)
      .set('Authorization', `Bearer ${recruiterAToken}`)
      .send({ status: 'COMPLETED', feedback: 'Foi bem.' })
      .expect(200);
    expect(res.body.status).toBe('COMPLETED');
    expect(res.body.feedback).toBe('Foi bem.');
  });

  it('candidato (sem interview:read no catálogo atual) tentando ver entrevista -> 403', () => {
    return request(app.getHttpServer())
      .get(`/interviews/${rescheduledInterviewId}`)
      .set('x-api-key', apiKey)
      .set('Authorization', `Bearer ${candidateToken}`)
      .expect(403);
  });

  // Achado CRÍTICO Qwen rodada 12 (K5): faltava `isCompanyOperable()` em
  // `InterviewsService` — recrutador de empresa desativada continuava
  // lendo/escrevendo entrevistas normalmente.
  describe('K5: empresa desativada bloqueia acesso do recrutador a entrevistas', () => {
    it('empresa desativada -> GET /applications/:id/interviews, GET /interviews/:id e PATCH todos 404', async () => {
      await prisma.company.update({ where: { id: companyAId }, data: { isActive: false } });
      try {
        const [listRes, getRes, patchRes] = await Promise.all([
          request(app.getHttpServer()).get(`/applications/${applicationInInterviewId}/interviews`).set('x-api-key', apiKey).set('Authorization', `Bearer ${recruiterAToken}`),
          request(app.getHttpServer()).get(`/interviews/${rescheduledInterviewId}`).set('x-api-key', apiKey).set('Authorization', `Bearer ${recruiterAToken}`),
          request(app.getHttpServer()).patch(`/interviews/${rescheduledInterviewId}`).set('x-api-key', apiKey).set('Authorization', `Bearer ${recruiterAToken}`).send({ feedback: 'x' }),
        ]);
        expect(listRes.status).toBe(404);
        expect(getRes.status).toBe(404);
        expect(patchRes.status).toBe(404);
      } finally {
        await prisma.company.update({ where: { id: companyAId }, data: { isActive: true } });
      }
    });
  });
});
