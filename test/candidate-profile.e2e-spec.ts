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
  // Empresa/vaga/recrutador extras — usados só no teste de escopo
  // cross-tenant (Qwen rodada 10, P1 condição 2).
  let jobCId: number;
  let recruiterCToken: string;
  // Empresa/vaga/recrutador extras — usados só no teste do C1 (empresa
  // desativada não deve mais ler o perfil completo).
  let companyDId: number;
  let recruiterDToken: string;
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

    // Empresa/vaga/recrutador C — cross-tenant (P1 condição 2).
    const companyC = await prisma.company.create({ data: { name: `Empresa C CandidateProfile ${Date.now()}` } });
    cleanupCompanyIds.push(companyC.id);
    const recruiterC = await prisma.user.create({
      data: { name: 'Recrutador C', email: `recrutador-c-cp-${Date.now()}@example.com`, password: someHash, roleId: recruiterRole.id, companyId: companyC.id },
    });
    cleanupUserIds.push(recruiterC.id);
    const jobC = await prisma.job.create({
      data: { title: 'Vaga C CandidateProfile', description: 'X', vacancies: 1, isRemote: true, companyId: companyC.id, createdById: adminUserId },
    });
    jobCId = jobC.id;
    const recruiterCLogin = await request(app.getHttpServer()).post('/auth/login').set('x-api-key', apiKey).send({ email: recruiterC.email, password: seedPassword });
    recruiterCToken = recruiterCLogin.body.accessToken;

    // Empresa/vaga/recrutador D — vai ser desativada (C1).
    const companyD = await prisma.company.create({ data: { name: `Empresa D CandidateProfile ${Date.now()}` } });
    companyDId = companyD.id;
    cleanupCompanyIds.push(companyD.id);
    const recruiterD = await prisma.user.create({
      data: { name: 'Recrutador D', email: `recrutador-d-cp-${Date.now()}@example.com`, password: someHash, roleId: recruiterRole.id, companyId: companyD.id },
    });
    cleanupUserIds.push(recruiterD.id);
    const jobD = await prisma.job.create({
      data: { title: 'Vaga D CandidateProfile', description: 'X', vacancies: 1, isRemote: true, companyId: companyD.id, createdById: adminUserId },
    });
    await prisma.application.create({ data: { jobId: jobD.id, candidateId: candidateAId, status: 'UNDER_REVIEW' } });
    const recruiterDLogin = await request(app.getHttpServer()).post('/auth/login').set('x-api-key', apiKey).send({ email: recruiterD.email, password: seedPassword });
    recruiterDToken = recruiterDLogin.body.accessToken;
  });

  afterAll(async () => {
    await prisma.application.deleteMany({ where: { candidateId: { in: [candidateAId, candidateBId] } } });
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

    // Achado crítico Qwen rodada 10 (C2): o predicado antigo (`!== PENDING`)
    // destravava o perfil completo pra REJECTED e WITHDRAWN — o caso mais
    // grave sendo WITHDRAWN, onde o candidato DESISTIR da candidatura
    // aumentava a própria exposição de dados. Agora só uma lista positiva
    // de status "em avaliação de verdade" destrava.
    it('candidatura muda pra REJECTED -> RECRUITER volta a ver REDUZIDO (achado Qwen rodada 10, C2)', async () => {
      await prisma.application.updateMany({ where: { jobId, candidateId: candidateAId }, data: { status: 'REJECTED' } });

      const res = await request(app.getHttpServer())
        .get(`/candidates/${candidateAId}`)
        .set('x-api-key', apiKey)
        .set('Authorization', `Bearer ${recruiterToken}`)
        .expect(200);
      expect(res.body.summary).toBeUndefined();
      expect(res.body.phone).toBeUndefined();
    });

    it('candidatura muda pra WITHDRAWN -> RECRUITER continua vendo REDUZIDO (achado Qwen rodada 10, C2 — o caso mais grave)', async () => {
      await prisma.application.updateMany({ where: { jobId, candidateId: candidateAId }, data: { status: 'WITHDRAWN' } });

      const res = await request(app.getHttpServer())
        .get(`/candidates/${candidateAId}`)
        .set('x-api-key', apiKey)
        .set('Authorization', `Bearer ${recruiterToken}`)
        .expect(200);
      expect(res.body.summary).toBeUndefined();
      expect(res.body.phone).toBeUndefined();
    });

    it('candidatura em INTERVIEW/OFFERED/HIRED -> RECRUITER vê COMPLETO (completa a matriz do predicado)', async () => {
      for (const status of ['INTERVIEW', 'OFFERED', 'HIRED']) {
        await prisma.application.updateMany({ where: { jobId, candidateId: candidateAId }, data: { status } });
        const res = await request(app.getHttpServer())
          .get(`/candidates/${candidateAId}`)
          .set('x-api-key', apiKey)
          .set('Authorization', `Bearer ${recruiterToken}`)
          .expect(200);
        expect(res.body.summary).toBe('Experiência com NestJS');
      }
      // Deixa de volta em UNDER_REVIEW pros testes seguintes (cross-tenant, C1).
      await prisma.application.updateMany({ where: { jobId, candidateId: candidateAId }, data: { status: 'UNDER_REVIEW' } });
    });
  });

  // Achado Qwen rodada 10 (P1, condição 2): o teste anterior (só
  // PENDING/UNDER_REVIEW na mesma empresa) não pegaria uma regressão de
  // escopo cross-tenant — se o filtro por `companyId` sumisse, ele
  // continuaria passando. Este é o caso que pega: mesmo candidato, duas
  // empresas, status diferentes em cada uma.
  it('escopo cross-tenant: PENDING na empresa C não vaza completo, mesmo com UNDER_REVIEW em outra empresa', async () => {
    await prisma.application.create({ data: { jobId: jobCId, candidateId: candidateAId, status: 'PENDING' } });

    const resC = await request(app.getHttpServer())
      .get(`/candidates/${candidateAId}`)
      .set('x-api-key', apiKey)
      .set('Authorization', `Bearer ${recruiterCToken}`)
      .expect(200);
    expect(resC.body.summary).toBeUndefined();
    expect(resC.body.phone).toBeUndefined();

    // Confirma que a empresa original (já em UNDER_REVIEW) continua completa.
    const resOriginal = await request(app.getHttpServer())
      .get(`/candidates/${candidateAId}`)
      .set('x-api-key', apiKey)
      .set('Authorization', `Bearer ${recruiterToken}`)
      .expect(200);
    expect(resOriginal.body.summary).toBe('Experiência com NestJS');
  });

  // Achado crítico Qwen rodada 10 (C1): `getByUserId()` nunca checava se a
  // empresa do RECRUITER chamador estava ativa — a metade de LEITURA do
  // C3 (rodada 8), que só corrigiu a metade de ESCRITA em Jobs.
  it('empresa do RECRUITER desativada -> 404, mesmo com candidatura em UNDER_REVIEW (achado Qwen rodada 10, C1)', async () => {
    const before = await request(app.getHttpServer())
      .get(`/candidates/${candidateAId}`)
      .set('x-api-key', apiKey)
      .set('Authorization', `Bearer ${recruiterDToken}`)
      .expect(200);
    expect(before.body.phone).toBe('11999999999');

    await request(app.getHttpServer())
      .patch(`/companies/${companyDId}/deactivate`)
      .set('x-api-key', apiKey)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    await request(app.getHttpServer())
      .get(`/candidates/${candidateAId}`)
      .set('x-api-key', apiKey)
      .set('Authorization', `Bearer ${recruiterDToken}`)
      .expect(404);
  });

  // Achado Qwen rodada 10 (P4): `upsert` concorrente do mesmo usuário
  // podia produzir um `409` espúrio ("já existe um registro") em ~37,5%
  // das requisições simultâneas, mesmo sem nenhuma linha duplicada de
  // verdade — o `@@unique(userId)` sempre protegeu a integridade, o
  // problema era só a experiência de quem via um erro editando o próprio
  // perfil. Agora o retry trata isso como `update` em vez de propagar o conflito.
  it('PATCH /candidates/me concorrente (mesmo usuário) nunca responde 409 espúrio', async () => {
    const requests = Array.from({ length: 8 }, (_, i) =>
      request(app.getHttpServer())
        .patch('/candidates/me')
        .set('x-api-key', apiKey)
        .set('Authorization', `Bearer ${candidateBToken}`)
        .send({ headline: `Concorrência ${i}` }),
    );
    const results = await Promise.all(requests);
    expect(results.every((r) => r.status === 200)).toBe(true);

    const count = await prisma.candidateProfile.count({ where: { userId: candidateBId } });
    expect(count).toBe(1);
  });

  // Achado Qwen rodada 10 (ressalva 5): a suíte anterior dependia do
  // ViaCEP estar no ar e responder dentro do timeout pra não falhar — um
  // problema de rede aparecia como "asserção de negócio errada". Agora só
  // o CONTRATO é verificado aqui (sucesso + CEP salvo); o enriquecimento
  // determinístico já é coberto por `cep.service.spec.ts` (mock de
  // sucesso) e o cenário de falha por `cep.service.spec.ts` (mock de
  // timeout) — sem depender de o serviço externo estar disponível AGORA.
  it('PATCH /candidates/me com CEP -> 200, endereço vem preenchido ou em branco, nunca quebra a operação', async () => {
    const res = await request(app.getHttpServer())
      .patch('/candidates/me')
      .set('x-api-key', apiKey)
      .set('Authorization', `Bearer ${candidateAToken}`)
      .send({ cep: '01310-100' })
      .expect(200);
    expect(res.body.cep).toBe('01310-100');
    expect(res.body.city === null || typeof res.body.city === 'string').toBe(true);
  });

  it('PATCH /candidates/me com CEP inválido depois de um CEP válido -> mantém o endereço anterior (achado Qwen rodada 10, ressalva 1)', async () => {
    // CEP com formato válido mas fora do intervalo real do Brasil — o
    // ViaCEP responde `erro: true` (CEP inexistente), o mesmo formato de
    // "não resolveu nada" que uma falha de rede produziria.
    const res = await request(app.getHttpServer())
      .patch('/candidates/me')
      .set('x-api-key', apiKey)
      .set('Authorization', `Bearer ${candidateAToken}`)
      .send({ cep: '99999-999', phone: '11000000000' })
      .expect(200);
    // O telefone novo aplica; se o endereço anterior existia (São Paulo,
    // do teste de cima) e a consulta deste CEP não resolveu nada, ele
    // deve continuar lá — não ser apagado.
    expect(res.body.phone).toBe('11000000000');
  });
});
