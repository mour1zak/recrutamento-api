import { rm } from 'node:fs/promises';
import { config as loadEnv } from 'dotenv';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { SYSTEM_ROLES } from '../src/common/constants/permissions.constants.js';
import { ApplicationStatus, JobStatus } from '../src/generated/prisma/client.js';

loadEnv({ path: process.env.NODE_ENV === 'test' ? '.env.test' : '.env' });

/**
 * Sexto módulo de domínio — o cenário obrigatório #8 do enunciado
 * (upload válido/inválido). MIME e tamanho são validados no
 * `FileInterceptor` (multer), antes de qualquer código nosso rodar —
 * por isso os testes de rejeição não passam nenhum `x-api-key`/JWT
 * inválido, só um arquivo que quebra a regra.
 */
describe('Documents (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const apiKey = process.env.API_KEY!;
  const seedPassword = process.env.SEED_USER_PASSWORD ?? 'Senha@123';

  let adminUserId: number;
  let recruiterAToken: string;
  let candidateAToken: string;
  let candidateAId: number;
  let candidateBToken: string;
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

    const [companyA, recruiterRole, someHash] = await Promise.all([
      prisma.company.create({ data: { name: `Empresa A Documents ${Date.now()}` } }),
      prisma.role.findUniqueOrThrow({ where: { name: SYSTEM_ROLES.RECRUITER } }),
      prisma.user.findFirstOrThrow({ where: { email: 'admin@recrutamento.test' }, omit: { password: false } }).then((u) => u.password),
    ]);
    cleanupCompanyIds.push(companyA.id);
    companyAId = companyA.id;

    const recruiterA = await prisma.user.create({ data: { name: 'Recrutador A Documents', email: `recrutador-a-documents-${Date.now()}@example.com`, password: someHash, roleId: recruiterRole.id, companyId: companyA.id } });
    cleanupUserIds.push(recruiterA.id);
    const recruiterALogin = await request(app.getHttpServer()).post('/auth/login').set('x-api-key', apiKey).send({ email: recruiterA.email, password: seedPassword });
    recruiterAToken = recruiterALogin.body.accessToken;

    const [registerA, registerB] = await Promise.all([
      request(app.getHttpServer()).post('/auth/register').set('x-api-key', apiKey).send({ name: 'Candidato A Documents', email: `candidato-a-documents-${Date.now()}@example.com`, password: 'SenhaForte@123' }),
      request(app.getHttpServer()).post('/auth/register').set('x-api-key', apiKey).send({ name: 'Candidato B Documents', email: `candidato-b-documents-${Date.now()}@example.com`, password: 'SenhaForte@123' }),
    ]);
    candidateAToken = registerA.body.accessToken;
    candidateAId = registerA.body.user.id;
    candidateBToken = registerB.body.accessToken;
    cleanupUserIds.push(candidateAId, registerB.body.user.id);

    const jobPending = await prisma.job.create({ data: { title: 'Vaga A Documents', description: 'X', vacancies: 1, isRemote: true, companyId: companyA.id, createdById: adminUserId, status: JobStatus.OPEN } });
    await prisma.application.create({ data: { jobId: jobPending.id, candidateId: candidateAId, status: ApplicationStatus.PENDING } });
  });

  afterAll(async () => {
    await prisma.application.deleteMany({ where: { job: { companyId: { in: cleanupCompanyIds } } } });
    // Arquivo em disco não é apagado em cascata pelo banco — o teste que
    // cria o arquivo é responsável por limpar (multer já limpa sozinho os
    // uploads rejeitados por tamanho, mas não os que chegam a ser
    // persistidos).
    const documents = await prisma.document.findMany({ where: { ownerId: { in: cleanupUserIds } }, omit: { path: false } });
    await Promise.all(documents.map((d) => rm(d.path, { force: true })));
    await prisma.document.deleteMany({ where: { ownerId: { in: cleanupUserIds } } });
    await prisma.refreshToken.deleteMany({ where: { userId: { in: cleanupUserIds } } });
    await prisma.job.deleteMany({ where: { companyId: { in: cleanupCompanyIds } } });
    await prisma.user.deleteMany({ where: { id: { in: cleanupUserIds } } });
    await prisma.company.deleteMany({ where: { id: { in: cleanupCompanyIds } } });
    await app.close();
  });

  let documentId: number;

  it('POST /documents (PDF válido) -> 201 {id, filename, mimeType, sizeBytes}', async () => {
    const res = await request(app.getHttpServer())
      .post('/documents')
      .set('x-api-key', apiKey)
      .set('Authorization', `Bearer ${candidateAToken}`)
      .field('type', 'RESUME')
      .attach('file', Buffer.from('%PDF-1.4 conteúdo de teste'), { filename: 'curriculo.pdf', contentType: 'application/pdf' })
      .expect(201);
    expect(res.body.mimeType).toBe('application/pdf');
    expect(res.body.filename).toBeDefined();
    expect(res.body.sizeBytes).toBeGreaterThan(0);
    documentId = res.body.id;
  });

  it('POST /documents sem arquivo -> 400 arquivo_ausente', async () => {
    const res = await request(app.getHttpServer())
      .post('/documents')
      .set('x-api-key', apiKey)
      .set('Authorization', `Bearer ${candidateAToken}`)
      .field('type', 'RESUME')
      .expect(400);
    expect(res.body.reason).toBe('arquivo_ausente');
  });

  it('POST /documents com MIME não permitido (.exe) -> 400 mime_type_invalido', async () => {
    const res = await request(app.getHttpServer())
      .post('/documents')
      .set('x-api-key', apiKey)
      .set('Authorization', `Bearer ${candidateAToken}`)
      .field('type', 'RESUME')
      .attach('file', Buffer.from('MZ conteúdo executável falso'), { filename: 'virus.exe', contentType: 'application/x-msdownload' })
      .expect(400);
    expect(res.body.reason).toBe('mime_type_invalido');
  });

  it('POST /documents com arquivo maior que o limite -> 400 arquivo_excede_tamanho_maximo', async () => {
    const res = await request(app.getHttpServer())
      .post('/documents')
      .set('x-api-key', apiKey)
      .set('Authorization', `Bearer ${candidateAToken}`)
      .field('type', 'RESUME')
      .attach('file', Buffer.alloc(5 * 1024 * 1024 + 1), { filename: 'grande.pdf', contentType: 'application/pdf' })
      .expect(400);
    expect(res.body.reason).toBe('arquivo_excede_tamanho_maximo');
  });

  it('RECRUITER (sem document:upload:own) tentando enviar documento -> 403', () => {
    return request(app.getHttpServer())
      .post('/documents')
      .set('x-api-key', apiKey)
      .set('Authorization', `Bearer ${recruiterAToken}`)
      .field('type', 'RESUME')
      .attach('file', Buffer.from('%PDF-1.4'), { filename: 'curriculo.pdf', contentType: 'application/pdf' })
      .expect(403);
  });

  it('GET /documents/me -> lista o próprio documento', async () => {
    const res = await request(app.getHttpServer()).get('/documents/me').set('x-api-key', apiKey).set('Authorization', `Bearer ${candidateAToken}`).expect(200);
    expect(res.body.some((d: { id: number }) => d.id === documentId)).toBe(true);
  });

  it('GET /documents/:id (dono) -> 200, stream do arquivo original', async () => {
    const res = await request(app.getHttpServer()).get(`/documents/${documentId}`).set('x-api-key', apiKey).set('Authorization', `Bearer ${candidateAToken}`).expect(200);
    expect(res.headers['content-disposition']).toContain('curriculo.pdf');
    expect(Buffer.isBuffer(res.body) ? res.body.length : Number(res.headers['content-length'])).toBeGreaterThan(0);
  });

  it('GET /documents/:id (outro candidato sem relação) -> 404', () => {
    return request(app.getHttpServer()).get(`/documents/${documentId}`).set('x-api-key', apiKey).set('Authorization', `Bearer ${candidateBToken}`).expect(404);
  });

  it('GET /documents/:id (recrutador, candidatura só PENDING na empresa) -> 404 (reduzido não dá acesso a documento)', () => {
    return request(app.getHttpServer()).get(`/documents/${documentId}`).set('x-api-key', apiKey).set('Authorization', `Bearer ${recruiterAToken}`).expect(404);
  });

  it('candidatura avança para UNDER_REVIEW E o documento é anexado -> recrutador da empresa agora consegue baixar', async () => {
    // Achado da revisão técnica (K6): acesso agora exige o vínculo EXPLÍCITO
    // (`resumeDocumentId` anexado à candidatura), não mais "qualquer
    // documento do candidato" — por isso este teste passa a anexar o
    // documento à candidatura antes de esperar acesso, o que reflete a
    // regra de negócio real (documento enviado PARA aquela candidatura).
    await prisma.application.updateMany({ where: { candidateId: candidateAId }, data: { status: ApplicationStatus.UNDER_REVIEW, resumeDocumentId: documentId } });
    const res = await request(app.getHttpServer()).get(`/documents/${documentId}`).set('x-api-key', apiKey).set('Authorization', `Bearer ${recruiterAToken}`).expect(200);
    expect(res.headers['content-disposition']).toContain('curriculo.pdf');
  });

  it('outro documento do MESMO candidato, nunca anexado -> continua 404 mesmo com a candidatura em UNDER_REVIEW (achado da revisão técnica, K6)', async () => {
    const res = await request(app.getHttpServer())
      .post('/documents')
      .set('x-api-key', apiKey)
      .set('Authorization', `Bearer ${candidateAToken}`)
      .field('type', 'OTHER')
      .attach('file', Buffer.from('%PDF-1.4 documento pessoal nunca anexado'), { filename: 'pessoal.pdf', contentType: 'application/pdf' })
      .expect(201);
    const unattachedDocumentId = res.body.id;

    await request(app.getHttpServer()).get(`/documents/${unattachedDocumentId}`).set('x-api-key', apiKey).set('Authorization', `Bearer ${recruiterAToken}`).expect(404);
  });

  // Achado CRÍTICO da revisão técnica (K5): faltava `isCompanyOperable()` em
  // `DocumentsService` — o caso mais grave do relatório, já que o
  // documento (currículo) continuava sendo baixado por um recrutador cuja
  // empresa acabou de ser desativada por um ADMIN.
  it('empresa desativada -> GET /documents/:id (mesmo com o documento anexado a candidatura qualificada) -> 404', async () => {
    await prisma.company.update({ where: { id: companyAId }, data: { isActive: false } });
    try {
      await request(app.getHttpServer()).get(`/documents/${documentId}`).set('x-api-key', apiKey).set('Authorization', `Bearer ${recruiterAToken}`).expect(404);
    } finally {
      await prisma.company.update({ where: { id: companyAId }, data: { isActive: true } });
    }
  });
});
