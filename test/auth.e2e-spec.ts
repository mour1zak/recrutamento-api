import { config as loadEnv } from 'dotenv';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module.js';

// Carrega o .env.test explicitamente ANTES de ler process.env abaixo — não
// depender de outro arquivo de teste já ter disparado o ConfigModule do
// Nest antes deste (isso funcionava por acidente de ordem de execução, não
// por garantia).
loadEnv({ path: process.env.NODE_ENV === 'test' ? '.env.test' : '.env' });

/**
 * Cobre os cenários exigidos pela auditoria Qwen rodada 4 (C3): 401 sem API
 * key, 401 sem JWT, 201 register, 401 login com senha errada, 409 email
 * duplicado — e o teste de permissão pedido em C2 (rota com @Permissions()
 * dando 2xx para quem tem a key e 403 para quem não tem).
 *
 * Pré-requisito: `npx prisma db seed` já rodado contra o banco de
 * `.env.test` (cria os papéis/permissões e os usuários admin/recrutador/
 * candidato usados aqui). Ver README.md §4.7.
 */
describe('Auth (e2e)', () => {
  let app: INestApplication<App>;
  const apiKey = process.env.API_KEY!;
  const seedPassword = process.env.SEED_USER_PASSWORD ?? 'Senha@123';
  const uniqueEmail = `teste-e2e-${Date.now()}@example.com`;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('POST /auth/login sem API key -> 401', () => {
    return request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'qualquer@example.com', password: 'qualquer' })
      .expect(401);
  });

  it('POST /auth/logout sem JWT (com API key) -> 401', () => {
    return request(app.getHttpServer())
      .post('/auth/logout')
      .set('x-api-key', apiKey)
      .send({ refreshToken: 'qualquer' })
      .expect(401);
  });

  it('POST /auth/register com body válido -> 201, sem senha na resposta', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .set('x-api-key', apiKey)
      .send({ name: 'Teste E2E', email: uniqueEmail, password: 'SenhaForte@123' })
      .expect(201);

    expect(res.body.user.email).toBe(uniqueEmail);
    expect(res.body.user.password).toBeUndefined();
    expect(res.body.accessToken).toBeDefined();
  });

  it('POST /auth/register com o MESMO email de novo -> 409', () => {
    return request(app.getHttpServer())
      .post('/auth/register')
      .set('x-api-key', apiKey)
      .send({ name: 'Teste E2E Duplicado', email: uniqueEmail, password: 'SenhaForte@123' })
      .expect(409);
  });

  it('POST /auth/register com body inválido (sem email) -> 400', () => {
    return request(app.getHttpServer())
      .post('/auth/register')
      .set('x-api-key', apiKey)
      .send({ name: 'Sem Email', password: 'SenhaForte@123' })
      .expect(400);
  });

  it('POST /auth/login com senha errada -> 401', () => {
    return request(app.getHttpServer())
      .post('/auth/login')
      .set('x-api-key', apiKey)
      .send({ email: uniqueEmail, password: 'senha-errada' })
      .expect(401);
  });

  it('POST /auth/login com credenciais corretas -> 200', () => {
    return request(app.getHttpServer())
      .post('/auth/login')
      .set('x-api-key', apiKey)
      .send({ email: uniqueEmail, password: 'SenhaForte@123' })
      .expect(200);
  });

  describe('rota protegida por permission key (@Permissions) — PATCH /users/:id/deactivate', () => {
    it('usuário SEM user:manage (candidato do seed) -> 403', async () => {
      const login = await request(app.getHttpServer())
        .post('/auth/login')
        .set('x-api-key', apiKey)
        .send({ email: 'candidato@recrutamento.test', password: seedPassword })
        .expect(200);

      return request(app.getHttpServer())
        .patch('/users/999999/deactivate')
        .set('x-api-key', apiKey)
        .set('Authorization', `Bearer ${login.body.accessToken}`)
        .expect(403);
    });

    it('usuário COM user:manage (admin do seed) -> não é 403 (passa da checagem de permissão)', async () => {
      const login = await request(app.getHttpServer())
        .post('/auth/login')
        .set('x-api-key', apiKey)
        .send({ email: 'admin@recrutamento.test', password: seedPassword })
        .expect(200);

      const res = await request(app.getHttpServer())
        .patch('/users/999999/deactivate')
        .set('x-api-key', apiKey)
        .set('Authorization', `Bearer ${login.body.accessToken}`);

      // 999999 não existe -> 404 do Service, não 403 do Guard. É exatamente
      // essa distinção que prova que o PermissionsGuard deixou passar.
      expect(res.status).toBe(404);
    });
  });
});
