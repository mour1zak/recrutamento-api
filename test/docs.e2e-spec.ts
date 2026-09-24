import { config as loadEnv } from 'dotenv';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { configureSwagger } from '../src/common/swagger.config.js';

loadEnv({ path: process.env.NODE_ENV === 'test' ? '.env.test' : '.env' });

/**
 * `/docs`/`/docs-json` são deliberadamente públicos (decisão final,
 * revertendo a recomendação em contrário de uma revisão técnica): a alternativa com
 * `x-api-key`/Basic Auth funcionava, mas a UX do popup nativo pedindo
 * "usuário/senha" pra uma chave sem conceito de usuário ficou confusa
 * demais pra valer a pena. O que continua valendo, independente dessa
 * decisão, é a correção do achado que tornava a exposição pública
 * perigosa: nenhum `example` do Swagger pode publicar uma credencial
 * REAL do seed — é o que este teste trava.
 */
describe('Docs (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    configureSwagger(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /docs sem nenhuma credencial -> 200 (público, decisão consciente)', () => {
    return request(app.getHttpServer()).get('/docs').expect(200);
  });

  it('GET /docs-json sem nenhuma credencial -> 200, sem credencial real nos examples', async () => {
    const res = await request(app.getHttpServer()).get('/docs-json').expect(200);
    const raw = JSON.stringify(res.body);
    // Achado crítico da revisão técnica (bloqueante): o `example` de
    // `LoginDto` publicava o email e a senha reais do ADMIN do seed —
    // combinados, davam um token de administrador a quem lesse o
    // documento. Trava de regressão: nenhuma credencial real do seed
    // pode aparecer em nenhum lugar do spec publicado, público ou não.
    expect(raw).not.toContain('admin@recrutamento.test');
    expect(raw).not.toContain('recrutador@recrutamento.test');
    expect(raw).not.toContain('candidato@recrutamento.test');
    expect(raw).not.toContain('Senha@123');
  });
});
