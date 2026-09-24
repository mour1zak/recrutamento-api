import { config as loadEnv } from 'dotenv';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module.js';
import { configureSwagger } from '../src/common/swagger.config.js';

loadEnv({ path: process.env.NODE_ENV === 'test' ? '.env.test' : '.env' });

/**
 * Achado CRÍTICO Qwen rodada 15: `/docs`/`/docs-json` estavam fora do
 * `ApiKeyGuard` (o `SwaggerModule.setup()` monta a UI/spec como
 * middleware Express puro, fora do pipeline de guards do Nest) — um
 * anônimo lia o `openapi.json` completo sem nenhuma credencial. Corrigido
 * com `createDocsAuthMiddleware`, registrado via `configureSwagger()`.
 * Este teste replica exatamente essa função (a mesma usada em `main.ts`)
 * pra garantir que a proteção real está no lugar, não só uma versão de
 * teste dela.
 */
describe('Docs auth (e2e)', () => {
  let app: INestApplication<App>;
  const apiKey = process.env.API_KEY!;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    configureSwagger(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /docs sem API key -> 401', () => {
    return request(app.getHttpServer()).get('/docs').expect(401);
  });

  it('GET /docs/ (barra final) sem API key -> 401', () => {
    return request(app.getHttpServer()).get('/docs/').expect(401);
  });

  it('GET /docs-json sem API key -> 401', () => {
    return request(app.getHttpServer()).get('/docs-json').expect(401);
  });

  it('GET /docs-json com API key errada -> 401', () => {
    return request(app.getHttpServer()).get('/docs-json').set('x-api-key', 'chave-invalida').expect(401);
  });

  it('GET /docs-json com API key correta -> 200, sem credencial real nos examples', async () => {
    const res = await request(app.getHttpServer()).get('/docs-json').set('x-api-key', apiKey).expect(200);
    const raw = JSON.stringify(res.body);
    // Achado crítico Qwen rodada 15 (bloqueante): o `example` de
    // `LoginDto` publicava o email e a senha reais do ADMIN do seed —
    // combinados, davam um token de administrador a quem lesse o
    // documento. Trava de regressão: nenhuma credencial real do seed
    // pode aparecer em nenhum lugar do spec publicado.
    expect(raw).not.toContain('admin@recrutamento.test');
    expect(raw).not.toContain('recrutador@recrutamento.test');
    expect(raw).not.toContain('candidato@recrutamento.test');
    expect(raw).not.toContain('Senha@123');
  });

  it('GET /docs com API key correta -> 200 (UI do Swagger)', () => {
    return request(app.getHttpServer()).get('/docs').set('x-api-key', apiKey).expect(200);
  });
});
