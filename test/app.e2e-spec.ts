import { config as loadEnv } from 'dotenv';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { configureCors } from '../src/common/cors.config.js';

loadEnv({ path: process.env.NODE_ENV === 'test' ? '.env.test' : '.env' });

// Precisa do header x-api-key (achado Qwen rodada 4, C3): o ApiKeyGuard é
// global desde a decisão CE-1, inclusive para o healthcheck. Este teste
// falhava (401) porque foi escrito antes dessa decisão e nunca atualizado.
describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureCors(app);
    await app.init();
  });

  it('/health (GET) sem API key -> 401', () => {
    return request(app.getHttpServer()).get('/health').expect(401);
  });

  it('/health (GET) com API key -> 200', () => {
    return request(app.getHttpServer())
      .get('/health')
      .set('x-api-key', process.env.API_KEY!)
      .expect(200)
      .expect(({ body }) => {
        if (body.status !== 'ok') throw new Error('esperado status "ok"');
      });
  });

  // Achado da auditoria final, pré-frontend: nenhum CORS estava
  // configurado — qualquer frontend rodando no navegador (porta
  // diferente da API) seria bloqueado pelo same-origin policy antes
  // mesmo de a requisição chegar aqui. `origin: true` (sem `CORS_ORIGIN`
  // no ambiente de teste) reflete a origem enviada de volta no header.
  it('responde com Access-Control-Allow-Origin (CORS habilitado pro frontend)', async () => {
    const res = await request(app.getHttpServer()).get('/health').set('x-api-key', process.env.API_KEY!).set('Origin', 'http://localhost:5173').expect(200);
    if (res.headers['access-control-allow-origin'] !== 'http://localhost:5173') {
      throw new Error(`esperado Access-Control-Allow-Origin refletindo a origem, veio "${res.headers['access-control-allow-origin']}"`);
    }
  });

  afterEach(async () => {
    await app.close();
  });
});
