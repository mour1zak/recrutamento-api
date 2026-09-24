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
 * Quarto módulo de domínio — o núcleo do negócio (candidatura). Cobre as
 * duas regras obrigatórias do enunciado: candidatura duplicada proibida
 * (`@@unique([candidateId, jobId])`) e vaga inativa não aceita candidatura
 * (`status !== OPEN` ou empresa desativada). A concorrência real (duas
 * contratações simultâneas na última vaga) usa o mesmo primitivo já
 * provado em Jobs/Auth: `UPDATE ... WHERE filledCount < vacancies`.
 */
describe('Applications (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const apiKey = process.env.API_KEY!;
  const seedPassword = process.env.SEED_USER_PASSWORD ?? 'Senha@123';

  let adminUserId: number;
  let recruiterAToken: string;
  let recruiterBToken: string;
  let companyAId: number;
  let jobOpenId: number;
  let jobDraftId: number;
  let candidateAToken: string;
  let candidateAId: number;
  let candidateBToken: string;
  let candidateBId: number;
  let jobInactiveCompanyId: number;
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
      prisma.company.create({ data: { name: `Empresa A Applications ${Date.now()}` } }),
      prisma.company.create({ data: { name: `Empresa B Applications ${Date.now()}`, isActive: false } }),
      prisma.role.findUniqueOrThrow({ where: { name: SYSTEM_ROLES.RECRUITER } }),
      prisma.user.findFirstOrThrow({ where: { email: 'admin@recrutamento.test' }, omit: { password: false } }).then((u) => u.password),
    ]);
    companyAId = companyA.id;
    cleanupCompanyIds.push(companyA.id, companyB.id);

    const [recruiterA, recruiterB] = await Promise.all([
      prisma.user.create({ data: { name: 'Recrutador A Apps', email: `recrutador-a-apps-${Date.now()}@example.com`, password: someHash, roleId: recruiterRole.id, companyId: companyA.id } }),
      prisma.user.create({ data: { name: 'Recrutador B Apps', email: `recrutador-b-apps-${Date.now()}@example.com`, password: someHash, roleId: recruiterRole.id, companyId: companyB.id } }),
    ]);
    cleanupUserIds.push(recruiterA.id, recruiterB.id);

    const [jobOpen, jobDraft, jobInactiveCompany] = await Promise.all([
      prisma.job.create({ data: { title: 'Vaga Aberta Apps', description: 'X', vacancies: 1, isRemote: true, companyId: companyA.id, createdById: adminUserId, status: JobStatus.OPEN } }),
      prisma.job.create({ data: { title: 'Vaga Rascunho Apps', description: 'X', vacancies: 1, isRemote: true, companyId: companyA.id, createdById: adminUserId } }),
      prisma.job.create({ data: { title: 'Vaga Empresa Inativa Apps', description: 'X', vacancies: 1, isRemote: true, companyId: companyB.id, createdById: adminUserId, status: JobStatus.OPEN } }),
    ]);
    jobOpenId = jobOpen.id;
    jobDraftId = jobDraft.id;
    jobInactiveCompanyId = jobInactiveCompany.id;

    const [loginA, loginB] = await Promise.all([
      request(app.getHttpServer()).post('/auth/login').set('x-api-key', apiKey).send({ email: recruiterA.email, password: seedPassword }),
      request(app.getHttpServer()).post('/auth/login').set('x-api-key', apiKey).send({ email: recruiterB.email, password: seedPassword }),
    ]);
    recruiterAToken = loginA.body.accessToken;
    recruiterBToken = loginB.body.accessToken;

    const [registerA, registerB] = await Promise.all([
      request(app.getHttpServer()).post('/auth/register').set('x-api-key', apiKey).send({ name: 'Candidato A Apps', email: `candidato-a-apps-${Date.now()}@example.com`, password: 'SenhaForte@123' }),
      request(app.getHttpServer()).post('/auth/register').set('x-api-key', apiKey).send({ name: 'Candidato B Apps', email: `candidato-b-apps-${Date.now()}@example.com`, password: 'SenhaForte@123' }),
    ]);
    candidateAToken = registerA.body.accessToken;
    candidateAId = registerA.body.user.id;
    candidateBToken = registerB.body.accessToken;
    candidateBId = registerB.body.user.id;
    cleanupUserIds.push(candidateAId, candidateBId);
  });

  afterAll(async () => {
    // `deleteMany` por `companyId` (não por `candidateId`) pra cobrir
    // também os candidatos X/Y criados só dentro do describe aninhado de
    // concorrência — qualquer candidatura ligada a uma vaga destas
    // empresas de teste precisa sumir antes do `Job.deleteMany` (FK).
    await prisma.applicationStatusHistory.deleteMany({ where: { application: { job: { companyId: { in: cleanupCompanyIds } } } } });
    await prisma.application.deleteMany({ where: { job: { companyId: { in: cleanupCompanyIds } } } });
    await prisma.refreshToken.deleteMany({ where: { userId: { in: cleanupUserIds } } });
    await prisma.job.deleteMany({ where: { companyId: { in: cleanupCompanyIds } } });
    await prisma.user.deleteMany({ where: { id: { in: cleanupUserIds } } });
    await prisma.company.deleteMany({ where: { id: { in: cleanupCompanyIds } } });
    await app.close();
  });

  let applicationAId: number;

  it('POST /jobs/:jobId/applications (candidato, vaga OPEN) -> 201, status PENDING', async () => {
    const res = await request(app.getHttpServer())
      .post(`/jobs/${jobOpenId}/applications`)
      .set('x-api-key', apiKey)
      .set('Authorization', `Bearer ${candidateAToken}`)
      .send({ coverLetter: 'Tenho muito interesse nesta vaga.' })
      .expect(201);
    expect(res.body.status).toBe('PENDING');
    applicationAId = res.body.id;
  });

  it('POST de novo, mesma vaga (regra obrigatória: candidatura duplicada) -> 409', async () => {
    const res = await request(app.getHttpServer())
      .post(`/jobs/${jobOpenId}/applications`)
      .set('x-api-key', apiKey)
      .set('Authorization', `Bearer ${candidateAToken}`)
      .send({})
      .expect(409);
    expect(res.body.reason).toBe('candidatura_duplicada');
  });

  it('POST em vaga DRAFT (regra obrigatória: vaga inativa não aceita candidatura) -> 409', async () => {
    const res = await request(app.getHttpServer())
      .post(`/jobs/${jobDraftId}/applications`)
      .set('x-api-key', apiKey)
      .set('Authorization', `Bearer ${candidateBToken}`)
      .send({})
      .expect(409);
    expect(res.body.reason).toBe('job_not_open');
  });

  it('POST em vaga inexistente -> 404', () => {
    return request(app.getHttpServer())
      .post('/jobs/999999/applications')
      .set('x-api-key', apiKey)
      .set('Authorization', `Bearer ${candidateBToken}`)
      .send({})
      .expect(404);
  });

  it('POST em vaga OPEN de empresa DESATIVADA -> 404 (mesma regra de visibilidade pública de Jobs)', () => {
    return request(app.getHttpServer())
      .post(`/jobs/${jobInactiveCompanyId}/applications`)
      .set('x-api-key', apiKey)
      .set('Authorization', `Bearer ${candidateBToken}`)
      .send({})
      .expect(404);
  });

  it('RECRUITER (sem application:create) tentando se candidatar -> 403', () => {
    return request(app.getHttpServer())
      .post(`/jobs/${jobOpenId}/applications`)
      .set('x-api-key', apiKey)
      .set('Authorization', `Bearer ${recruiterAToken}`)
      .send({})
      .expect(403);
  });

  it('GET /applications/me (candidato A) -> só as próprias', async () => {
    const res = await request(app.getHttpServer())
      .get('/applications/me')
      .set('x-api-key', apiKey)
      .set('Authorization', `Bearer ${candidateAToken}`)
      .expect(200);
    expect(res.body.data.some((a: { id: number }) => a.id === applicationAId)).toBe(true);
  });

  it('GET /jobs/:jobId/applications (recrutador da própria empresa) -> 200, lista a candidatura', async () => {
    const res = await request(app.getHttpServer())
      .get(`/jobs/${jobOpenId}/applications`)
      .set('x-api-key', apiKey)
      .set('Authorization', `Bearer ${recruiterAToken}`)
      .expect(200);
    expect(res.body.data.some((a: { id: number }) => a.id === applicationAId)).toBe(true);
  });

  it('GET /jobs/:jobId/applications (recrutador de OUTRA empresa) -> 404 (anti-enumeração)', () => {
    return request(app.getHttpServer())
      .get(`/jobs/${jobOpenId}/applications`)
      .set('x-api-key', apiKey)
      .set('Authorization', `Bearer ${recruiterBToken}`)
      .expect(404);
  });

  it('GET /applications/:id (dono) -> completo', async () => {
    const res = await request(app.getHttpServer())
      .get(`/applications/${applicationAId}`)
      .set('x-api-key', apiKey)
      .set('Authorization', `Bearer ${candidateAToken}`)
      .expect(200);
    expect(res.body.candidateId).toBe(candidateAId);
  });

  it('GET /applications/:id (recrutador da empresa, status PENDING) -> reduzido', async () => {
    const res = await request(app.getHttpServer())
      .get(`/applications/${applicationAId}`)
      .set('x-api-key', apiKey)
      .set('Authorization', `Bearer ${recruiterAToken}`)
      .expect(200);
    // Payload reduzido não traz o `job` aninhado nem `candidateId` cru —
    // só o necessário pra triagem inicial.
    expect(res.body.job).toBeUndefined();
    expect(res.body.candidate.name).toBeDefined();
  });

  it('GET /applications/:id (recrutador de OUTRA empresa) -> 404', () => {
    return request(app.getHttpServer())
      .get(`/applications/${applicationAId}`)
      .set('x-api-key', apiKey)
      .set('Authorization', `Bearer ${recruiterBToken}`)
      .expect(404);
  });

  it('PATCH /applications/:id/status transição inválida (PENDING -> HIRED direto) -> 400', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/applications/${applicationAId}/status`)
      .set('x-api-key', apiKey)
      .set('Authorization', `Bearer ${recruiterAToken}`)
      .send({ status: 'HIRED' })
      .expect(400);
    expect(res.body.reason).toBe('invalid_status_transition');
  });

  it('PATCH /applications/:id/status (recrutador de OUTRA empresa) -> 404', () => {
    return request(app.getHttpServer())
      .patch(`/applications/${applicationAId}/status`)
      .set('x-api-key', apiKey)
      .set('Authorization', `Bearer ${recruiterBToken}`)
      .send({ status: 'UNDER_REVIEW' })
      .expect(404);
  });

  it('PATCH /applications/:id/status PENDING -> UNDER_REVIEW -> 200', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/applications/${applicationAId}/status`)
      .set('x-api-key', apiKey)
      .set('Authorization', `Bearer ${recruiterAToken}`)
      .send({ status: 'UNDER_REVIEW' })
      .expect(200);
    expect(res.body.status).toBe('UNDER_REVIEW');
  });

  it('GET /applications/:id (recrutador, status UNDER_REVIEW) -> completo agora', async () => {
    const res = await request(app.getHttpServer())
      .get(`/applications/${applicationAId}`)
      .set('x-api-key', apiKey)
      .set('Authorization', `Bearer ${recruiterAToken}`)
      .expect(200);
    expect(res.body.job).toBeDefined();
  });

  it('fluxo completo até HIRED incrementa Job.filledCount', async () => {
    await request(app.getHttpServer()).patch(`/applications/${applicationAId}/status`).set('x-api-key', apiKey).set('Authorization', `Bearer ${recruiterAToken}`).send({ status: 'INTERVIEW' }).expect(200);
    await request(app.getHttpServer()).patch(`/applications/${applicationAId}/status`).set('x-api-key', apiKey).set('Authorization', `Bearer ${recruiterAToken}`).send({ status: 'OFFERED' }).expect(200);
    const hireRes = await request(app.getHttpServer()).patch(`/applications/${applicationAId}/status`).set('x-api-key', apiKey).set('Authorization', `Bearer ${recruiterAToken}`).send({ status: 'HIRED' }).expect(200);
    expect(hireRes.body.status).toBe('HIRED');

    const job = await prisma.job.findUniqueOrThrow({ where: { id: jobOpenId } });
    expect(job.filledCount).toBe(1);
  });

  it('PATCH /applications/:id/withdraw em candidatura HIRED (terminal) -> 409', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/applications/${applicationAId}/withdraw`)
      .set('x-api-key', apiKey)
      .set('Authorization', `Bearer ${candidateAToken}`)
      .send({})
      .expect(409);
    expect(res.body.reason).toBe('application_ja_encerrada');
  });

  describe('capacidade concorrente (Gate Fase 3): última vaga, duas contratações simultâneas', () => {
    let jobOneVacancyId: number;
    let appXId: number;
    let appYId: number;
    let candidateXToken: string;
    let candidateXId: number;
    let candidateYToken: string;
    let candidateYId: number;

    beforeAll(async () => {
      const job = await prisma.job.create({ data: { title: 'Vaga 1 posição Apps', description: 'X', vacancies: 1, isRemote: true, companyId: companyAId, createdById: adminUserId, status: JobStatus.OPEN } });
      jobOneVacancyId = job.id;

      const [registerX, registerY] = await Promise.all([
        request(app.getHttpServer()).post('/auth/register').set('x-api-key', apiKey).send({ name: 'Candidato X Apps', email: `candidato-x-apps-${Date.now()}@example.com`, password: 'SenhaForte@123' }),
        request(app.getHttpServer()).post('/auth/register').set('x-api-key', apiKey).send({ name: 'Candidato Y Apps', email: `candidato-y-apps-${Date.now()}@example.com`, password: 'SenhaForte@123' }),
      ]);
      candidateXToken = registerX.body.accessToken;
      candidateXId = registerX.body.user.id;
      candidateYToken = registerY.body.accessToken;
      candidateYId = registerY.body.user.id;
      cleanupUserIds.push(candidateXId, candidateYId);

      const [appX, appY] = await Promise.all([
        request(app.getHttpServer()).post(`/jobs/${jobOneVacancyId}/applications`).set('x-api-key', apiKey).set('Authorization', `Bearer ${candidateXToken}`).send({}),
        request(app.getHttpServer()).post(`/jobs/${jobOneVacancyId}/applications`).set('x-api-key', apiKey).set('Authorization', `Bearer ${candidateYToken}`).send({}),
      ]);
      appXId = appX.body.id;
      appYId = appY.body.id;

      for (const id of [appXId, appYId]) {
        await request(app.getHttpServer()).patch(`/applications/${id}/status`).set('x-api-key', apiKey).set('Authorization', `Bearer ${recruiterAToken}`).send({ status: 'UNDER_REVIEW' }).expect(200);
        await request(app.getHttpServer()).patch(`/applications/${id}/status`).set('x-api-key', apiKey).set('Authorization', `Bearer ${recruiterAToken}`).send({ status: 'INTERVIEW' }).expect(200);
        await request(app.getHttpServer()).patch(`/applications/${id}/status`).set('x-api-key', apiKey).set('Authorization', `Bearer ${recruiterAToken}`).send({ status: 'OFFERED' }).expect(200);
      }
    });

    it('duas requisições HIRED simultâneas para a mesma vaga (1 posição): exatamente uma vence, nunca 5xx', async () => {
      const [resX, resY] = await Promise.all([
        request(app.getHttpServer()).patch(`/applications/${appXId}/status`).set('x-api-key', apiKey).set('Authorization', `Bearer ${recruiterAToken}`).send({ status: 'HIRED' }),
        request(app.getHttpServer()).patch(`/applications/${appYId}/status`).set('x-api-key', apiKey).set('Authorization', `Bearer ${recruiterAToken}`).send({ status: 'HIRED' }),
      ]);
      const statuses = [resX.status, resY.status].sort((a, b) => a - b);
      expect(statuses).toEqual([200, 409]);
      expect([resX.body.reason, resY.body.reason].filter(Boolean)).toContain('no_vacancies_left');

      const job = await prisma.job.findUniqueOrThrow({ where: { id: jobOneVacancyId } });
      expect(job.filledCount).toBe(1);
    });
  });

  // Achado CRÍTICO da revisão técnica (K1): a versão anterior comparava
  // `filledCount` (coluna) contra `application.job.vacancies` — um NÚMERO
  // lido ANTES da transação de contratação começar, não a coluna
  // `vacancies` em si. O teste de concorrência acima (duas contratações
  // simultâneas, `vacancies` ESTÁVEL) não pegava isso — as duas
  // comparações só divergem quando `vacancies` MUDA no meio do caminho.
  // Medido na revisão técnica: reduzir `vacancies` enquanto uma contratação está
  // em voo produzia `filledCount > vacancies` em 15 de 25 corridas.
  // Corrigido com SQL parametrizado comparando coluna×coluna
  // (`$executeRaw`), e reforçado com um `CHECK` na migration como rede de
  // segurança. Este teste reproduz o cenário exato do relatório.
  describe('K1: reduzir vacancies ENQUANTO uma contratação está em voo nunca viola filledCount <= vacancies', () => {
    let jobId: number;
    let applicationId: number;

    beforeAll(async () => {
      const job = await prisma.job.create({ data: { title: 'Vaga K1 Apps', description: 'X', vacancies: 3, isRemote: true, companyId: companyAId, createdById: adminUserId, status: JobStatus.OPEN } });
      jobId = job.id;

      const register = await request(app.getHttpServer()).post('/auth/register').set('x-api-key', apiKey).send({ name: 'Candidato K1 Apps', email: `candidato-k1-apps-${Date.now()}@example.com`, password: 'SenhaForte@123' });
      const candidateToken = register.body.accessToken;
      cleanupUserIds.push(register.body.user.id);

      const application = await request(app.getHttpServer()).post(`/jobs/${jobId}/applications`).set('x-api-key', apiKey).set('Authorization', `Bearer ${candidateToken}`).send({});
      applicationId = application.body.id;
      for (const status of ['UNDER_REVIEW', 'INTERVIEW', 'OFFERED']) {
        await request(app.getHttpServer()).patch(`/applications/${applicationId}/status`).set('x-api-key', apiKey).set('Authorization', `Bearer ${recruiterAToken}`).send({ status }).expect(200);
      }
    });

    it('5 rodadas: vacancies=3->2 disputa com a 3ª contratação — nunca fica filledCount > vacancies', async () => {
      for (let round = 0; round < 5; round++) {
        // Estado de partida de cada rodada: 2 posições já preenchidas
        // (simulando contratações anteriores), a 3ª candidatura pronta
        // pra ser contratada (`OFFERED`), vacancies ainda em 3.
        await prisma.job.update({ where: { id: jobId }, data: { vacancies: 3, filledCount: 2 } });
        await prisma.application.update({ where: { id: applicationId }, data: { status: 'OFFERED' } });

        const [reduceRes, hireRes] = await Promise.all([
          request(app.getHttpServer()).patch(`/jobs/${jobId}`).set('x-api-key', apiKey).set('Authorization', `Bearer ${recruiterAToken}`).send({ vacancies: 2 }),
          request(app.getHttpServer()).patch(`/applications/${applicationId}/status`).set('x-api-key', apiKey).set('Authorization', `Bearer ${recruiterAToken}`).send({ status: 'HIRED' }),
        ]);

        // Nunca 5xx dos dois lados.
        expect([reduceRes.status, hireRes.status].every((s) => s < 500)).toBe(true);

        const job = await prisma.job.findUniqueOrThrow({ where: { id: jobId } });
        // O invariante que importa, exatamente como a revisão técnica mediu: nunca
        // `filledCount > vacancies`, não importa qual dos dois venceu a
        // corrida.
        expect(job.filledCount).toBeLessThanOrEqual(job.vacancies);
      }
    });
  });

  // Achado CRÍTICO da revisão técnica (K5): `isCompanyOperable()` foi extraído
  // anteriormente exatamente pra este consumidor (o comentário do próprio
  // helper diz isso) e nunca foi importado em `ApplicationsService`. Sem
  // ele, um recrutador de empresa desativada continuava lendo e
  // escrevendo candidaturas normalmente — medido na revisão técnica com o mesmo
  // token, no mesmo instante, contra `Jobs` (404 correto) e
  // `Applications` (200 incorreto).
  describe('K5: empresa desativada bloqueia acesso do recrutador a candidaturas', () => {
    it('empresa desativada -> GET /jobs/:jobId/applications, GET /applications/:id e PATCH .../status todos 404', async () => {
      await prisma.company.update({ where: { id: companyAId }, data: { isActive: false } });
      try {
        const [listRes, getRes, patchRes] = await Promise.all([
          request(app.getHttpServer()).get(`/jobs/${jobOpenId}/applications`).set('x-api-key', apiKey).set('Authorization', `Bearer ${recruiterAToken}`),
          request(app.getHttpServer()).get(`/applications/${applicationAId}`).set('x-api-key', apiKey).set('Authorization', `Bearer ${recruiterAToken}`),
          request(app.getHttpServer()).patch(`/applications/${applicationAId}/status`).set('x-api-key', apiKey).set('Authorization', `Bearer ${recruiterAToken}`).send({ status: 'REJECTED' }),
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
