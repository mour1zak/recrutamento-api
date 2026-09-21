import { config as loadEnv } from 'dotenv';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module.js';

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

  afterEach(async () => {
    await app.close();
  });
});
