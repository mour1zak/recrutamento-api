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
  let adminUserId: number;
  let candidateToken: string;
  let recruiterAToken: string;
  let recruiterBToken: string;
  let seedRecruiterToken: string;
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
    adminUserId = adminLogin.body.user.id;
    candidateToken = candidateLogin.body.accessToken;

    // Achado crítico Qwen rodada 8 (C1): login com o RECRUITER real do
    // seed, não um fabricado via Prisma com `companyId` já definido — foi
    // exatamente a fabricação manual que deixou o bug (companyId null =
    // acesso global) invisível para a suíte anterior.
    const seedRecruiterLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .set('x-api-key', apiKey)
      .send({ email: 'recrutador@recrutamento.test', password: seedPassword });
    seedRecruiterToken = seedRecruiterLogin.body.accessToken;

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
      // filledCount só é escrito pelo fluxo de contratação (Application,
      // Fase 4) — simulado direto no banco pra testar a invariante do
      // Service isoladamente. Achado Qwen rodada 12 (K1): agora existe um
      // `CHECK (filledCount <= vacancies)` na migration — `vacancies`
      // precisa subir JUNTO com `filledCount` neste setup direto, senão o
      // próprio `UPDATE` de preparação do teste já viola a constraint
      // (é exatamente essa constraint que garante que o cenário que este
      // teste tenta simular nunca exista de verdade fora de um teste).
      await prisma.job.update({ where: { id: jobId }, data: { vacancies: 2, filledCount: 2 } });

      const res = await request(app.getHttpServer())
        .patch(`/jobs/${jobId}`)
        .set('x-api-key', apiKey)
        .set('Authorization', `Bearer ${recruiterAToken}`)
        .send({ vacancies: 1 })
        .expect(409);
      expect(res.body.reason).toBe('vacancies_below_filled_count');

      await prisma.job.update({ where: { id: jobId }, data: { filledCount: 0, vacancies: 1 } });
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

    it('GET /jobs/:id (OPEN) inclui o nome da empresa (achado Qwen rodada 8, R1)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/jobs/${jobId}`)
        .set('x-api-key', apiKey)
        .set('Authorization', `Bearer ${candidateToken}`)
        .expect(200);
      expect(res.body.company).toEqual({ id: companyAId, name: expect.any(String) });
    });

    it('GET /jobs (lista pública) não expõe createdById nem filledCount (achado Qwen rodada 8, R5)', async () => {
      const res = await request(app.getHttpServer()).get('/jobs?limit=100').set('x-api-key', apiKey).expect(200);
      const item = res.body.data.find((j: { id: number }) => j.id === jobId);
      expect(item).toBeDefined();
      expect(item.createdById).toBeUndefined();
      expect(item.filledCount).toBeUndefined();
      expect(item.company).toEqual({ id: companyAId, name: expect.any(String) });
    });
  });

  /**
   * Achado crítico Qwen rodada 8 (C1): `companyId: null` era tratado como
   * "acesso a qualquer empresa" em `isInScope()`/`resolveCompanyIdForCreate()`
   * — e o RECRUITER do seed nascia sem `companyId`, com senha pública. O
   * Qwen editou, cancelou e leu vaga de outra empresa, e chegou a criar e
   * publicar uma vaga em nome de empresa alheia, usando só a credencial
   * documentada do seed. Corrigido: seed agora vincula o recrutador a uma
   * empresa; `isInScope`/`resolveCompanyIdForCreate` tratam "sem empresa
   * e não-ADMIN" como fora de escopo, igual `findMine` já fazia.
   */
  describe('C1 (rodada 8): recrutador do SEED nunca tem acesso global', () => {
    let companyJobIdForSeedTest: number;

    beforeAll(async () => {
      const job = await prisma.job.create({
        data: { title: 'Vaga da Empresa A (alvo do teste C1)', description: 'X', vacancies: 1, isRemote: true, companyId: companyAId, createdById: adminUserId },
      });
      companyJobIdForSeedTest = job.id;
    });

    it('PATCH numa vaga de outra empresa -> 404 (antes: 200, editava de verdade)', () => {
      return request(app.getHttpServer())
        .patch(`/jobs/${companyJobIdForSeedTest}`)
        .set('x-api-key', apiKey)
        .set('Authorization', `Bearer ${seedRecruiterToken}`)
        .send({ title: 'HACKEADO-PELO-SEED-RECRUITER' })
        .expect(404);
    });

    it('PATCH status numa vaga de outra empresa -> 404 (antes: 200, cancelava de verdade)', () => {
      return request(app.getHttpServer())
        .patch(`/jobs/${companyJobIdForSeedTest}/status`)
        .set('x-api-key', apiKey)
        .set('Authorization', `Bearer ${seedRecruiterToken}`)
        .send({ status: 'CANCELED' })
        .expect(404);
    });

    it('GET (DRAFT) de vaga de outra empresa -> 404 (antes: 200)', () => {
      return request(app.getHttpServer())
        .get(`/jobs/${companyJobIdForSeedTest}`)
        .set('x-api-key', apiKey)
        .set('Authorization', `Bearer ${seedRecruiterToken}`)
        .expect(404);
    });

    it('POST /jobs com companyId de empresa alheia -> 404 (antes: 201, publicava vaga em nome de terceiro)', () => {
      return request(app.getHttpServer())
        .post('/jobs')
        .set('x-api-key', apiKey)
        .set('Authorization', `Bearer ${seedRecruiterToken}`)
        .send({ title: 'Vaga Plantada', description: 'X', vacancies: 1, isRemote: true, companyId: companyAId })
        .expect(404);
    });
  });

  /**
   * Achado crítico Qwen rodada 8 (C2): `updateStatus()` fazia
   * leitura-então-escrita em passos separados — duas transições
   * simultâneas na mesma vaga liam o mesmo status de origem, as duas
   * passavam na validação, e a última escrita vencia, sobrescrevendo um
   * estado TERMINAL (`CANCELED`) em 52% das corridas medidas pelo Qwen.
   * Corrigido com `updateMany` condicionado ao status lido — a segunda
   * escrita perde de verdade, nunca aplica por cima silenciosamente.
   */
  describe('C2 (rodada 8, asserção corrigida na rodada 9): duas transições simultâneas nunca sobrescrevem um estado terminal', () => {
    // Achado Qwen rodada 9 (N2): a asserção original ("exatamente uma
    // responde 200") é FALSA como invariante — existe um entrelaçamento
    // legítimo em que a requisição de PAUSED commita primeiro, e a de
    // CANCELED lê `PAUSED` depois (não mais `OPEN`) e aplica
    // `PAUSED→CANCELED`, que É uma transição válida. Isso produz
    // `[200,200]` com `final=CANCELED` — resultado correto, não uma
    // corrida perdida. A versão anterior deste teste falhava ~5% das
    // execuções nesse cenário legítimo (Qwen capturou
    // `AssertionError: expected 2 to be 1` rodando 20x).
    //
    // O invariante real (o que "nunca sobrescreve estado terminal"
    // realmente significa): nenhum 5xx; o estado final é sempre um dos
    // dois pedidos (nunca um terceiro valor); e se a requisição de
    // CANCELED respondeu 200, o estado final TEM que ser CANCELED — um
    // "sim" pra cancelar nunca pode ser desfeito por um "pause" perdedor.
    // Rodado 10x (sugestão do Qwen — uma corrida só não pega regressão
    // com confiança), cada vez numa vaga nova.
    it('OPEN -> {CANCELED, PAUSED} simultâneos, 10 rodadas: nenhum 5xx, e CANCELED bem-sucedido nunca é desfeito', async () => {
      for (let i = 0; i < 10; i++) {
        const job = await prisma.job.create({
          data: { title: `Vaga Concorrência ${i}`, description: 'X', vacancies: 1, isRemote: true, companyId: companyAId, createdById: adminUserId, status: 'OPEN' },
        });

        const [cancelRes, pauseRes] = await Promise.all([
          request(app.getHttpServer())
            .patch(`/jobs/${job.id}/status`)
            .set('x-api-key', apiKey)
            .set('Authorization', `Bearer ${recruiterAToken}`)
            .send({ status: 'CANCELED' }),
          request(app.getHttpServer())
            .patch(`/jobs/${job.id}/status`)
            .set('x-api-key', apiKey)
            .set('Authorization', `Bearer ${recruiterAToken}`)
            .send({ status: 'PAUSED' }),
        ]);

        const statuses = [cancelRes.status, pauseRes.status];
        expect(statuses.every((s) => s < 500)).toBe(true);

        const fresh = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
        expect(['CANCELED', 'PAUSED']).toContain(fresh.status);
        if (cancelRes.status === 200) {
          // Regra de ouro: se o cancelamento foi aceito, ele é definitivo
          // — nada pode tê-lo revertido, nem um PAUSED que chegou depois.
          expect(fresh.status).toBe('CANCELED');
        }

        await prisma.job.delete({ where: { id: job.id } });
      }
    });
  });

  /**
   * Achado crítico Qwen rodada 8 (C3): só o ramo ADMIN de
   * `resolveCompanyIdForCreate` checava `company.isActive` — um
   * RECRUITER de empresa desativada continuava criando, editando e
   * publicando vagas normalmente (a vaga aparecia na vitrine pública),
   * enquanto `GET /companies/:id` já dizia "não encontrada" pra essa
   * mesma empresa. Decisão aplicada: `isActive` da empresa é checada em
   * toda ESCRITA de vaga (create/update/updateStatus); leituras de vagas
   * já `OPEN` não são afetadas retroativamente.
   */
  describe('C3 (rodada 8): recrutador de empresa desativada não opera mais vagas', () => {
    let inactiveCompanyRecruiterToken: string;
    let openJobOfInactiveCompanyId: number;

    beforeAll(async () => {
      const [recruiterRole, seedRecruiter] = await Promise.all([
        prisma.role.findUniqueOrThrow({ where: { name: SYSTEM_ROLES.RECRUITER } }),
        prisma.user.findFirstOrThrow({ where: { email: 'recrutador@recrutamento.test' }, omit: { password: false } }),
      ]);
      const company = await prisma.company.create({ data: { name: `Empresa Será Desativada ${Date.now()}` } });
      cleanupCompanyIds.push(company.id);

      const recruiter = await prisma.user.create({
        data: { name: 'Recrutador Empresa Desativada', email: `recrutador-desativada-${Date.now()}@example.com`, password: seedRecruiter.password, roleId: recruiterRole.id, companyId: company.id },
      });
      cleanupUserIds.push(recruiter.id);

      const openJob = await prisma.job.create({
        data: { title: 'Vaga já aberta antes da desativação', description: 'X', vacancies: 1, isRemote: true, companyId: company.id, createdById: adminUserId, status: 'OPEN' },
      });
      openJobOfInactiveCompanyId = openJob.id;

      const login = await request(app.getHttpServer()).post('/auth/login').set('x-api-key', apiKey).send({ email: recruiter.email, password: seedPassword });
      inactiveCompanyRecruiterToken = login.body.accessToken;

      await request(app.getHttpServer())
        .patch(`/companies/${company.id}/deactivate`)
        .set('x-api-key', apiKey)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
    });

    it('POST /jobs pelo recrutador da empresa desativada -> 404 (antes: 201)', () => {
      return request(app.getHttpServer())
        .post('/jobs')
        .set('x-api-key', apiKey)
        .set('Authorization', `Bearer ${inactiveCompanyRecruiterToken}`)
        .send({ title: 'Vaga Empresa Desativada', description: 'X', vacancies: 1, isRemote: true })
        .expect(404);
    });

    it('PATCH /jobs/:id/status (DRAFT->OPEN) pelo recrutador da empresa desativada -> 404 (antes: 200, publicava)', () => {
      return request(app.getHttpServer())
        .patch(`/jobs/${openJobOfInactiveCompanyId}/status`)
        .set('x-api-key', apiKey)
        .set('Authorization', `Bearer ${inactiveCompanyRecruiterToken}`)
        .send({ status: 'PAUSED' })
        .expect(404);
    });

    // Achado Qwen rodada 9 (Q3/N8): a decisão original da rodada 8 ("sem
    // cascata retroativa — vaga já OPEN continua na vitrine") criava uma
    // inconsistência visível: a vitrine anunciava uma empresa que a
    // própria API já dizia não existir (`GET /companies/:id` → 404).
    // Corrigido sem cascatear o STATUS da vaga (isso destruiria
    // informação que o `reactivate` não conseguiria desfazer) — só a
    // VISIBILIDADE pública passou a considerar `company.isActive`.
    it('vaga já OPEN da empresa desativada some da vitrine pública e do detalhe público (Q3/N8, rodada 9)', async () => {
      const list = await request(app.getHttpServer()).get('/jobs?limit=100').set('x-api-key', apiKey).expect(200);
      expect(list.body.data.some((j: { id: number }) => j.id === openJobOfInactiveCompanyId)).toBe(false);

      // Mas o dono (job:read:any + mesma empresa) continua lendo o
      // próprio histórico normalmente — não é um "sumiço" de verdade.
      await request(app.getHttpServer())
        .get(`/jobs/${openJobOfInactiveCompanyId}`)
        .set('x-api-key', apiKey)
        .set('Authorization', `Bearer ${inactiveCompanyRecruiterToken}`)
        .expect(200);
    });

    it('vaga já OPEN da empresa desativada -> 404 pra quem não é dono (candidate, ex-visitante público)', () => {
      return request(app.getHttpServer())
        .get(`/jobs/${openJobOfInactiveCompanyId}`)
        .set('x-api-key', apiKey)
        .set('Authorization', `Bearer ${candidateToken}`)
        .expect(404);
    });
  });
});
