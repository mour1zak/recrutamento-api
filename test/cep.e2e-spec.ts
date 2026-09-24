import { config as loadEnv } from 'dotenv';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';

loadEnv({ path: process.env.NODE_ENV === 'test' ? '.env.test' : '.env' });

/**
 * `GET /cep/:cep` — utilidade pedida à parte (não é requisito do
 * enunciado): frontend consulta um CEP isoladamente pra autopreencher
 * rua/cidade/estado ANTES de submeter o formulário de Company/
 * CandidateProfile, que já resolviam CEP internamente mas sem expor isso
 * como consulta independente. Mesmo `CepService` que `companies.e2e-spec.ts`
 * já exercita contra o ViaCEP de verdade, sem mock — o caminho
 * "provedor indisponível" fica só no unit test (`cep.service.spec.ts`),
 * que já cobre isso de forma determinística.
 */
describe('CEP lookup (e2e)', () => {
  let app: INestApplication<App>;
  const apiKey = process.env.API_KEY!;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /cep/:cep sem API key -> 401', () => {
    return request(app.getHttpServer()).get('/cep/01310-100').expect(401);
  });

  it('GET /cep/:cep com formato inválido -> 400', () => {
    return request(app.getHttpServer())
      .get('/cep/123')
      .set('x-api-key', apiKey)
      .expect(400)
      .expect(({ body }) => {
        if (body.reason !== 'cep_formato_invalido') throw new Error(`esperado reason cep_formato_invalido, veio ${body.reason}`);
      });
  });

  it('GET /cep/:cep válido (real, sem mock) -> 200 com endereço', async () => {
    const res = await request(app.getHttpServer()).get('/cep/01310-100').set('x-api-key', apiKey).expect(200);
    if (!res.body.street || !res.body.city || !res.body.state) {
      throw new Error(`esperado endereço preenchido, veio ${JSON.stringify(res.body)}`);
    }
  });

  // Achado Qwen rodada 11 (N1), mesmo contrato reutilizado aqui: CEP que o
  // provedor confirma não existir é erro de quem perguntou (400), nunca
  // silenciosamente devolvido como endereço vazio.
  it('GET /cep/:cep inexistente (real, sem mock) -> 400, reason cep_nao_encontrado', () => {
    return request(app.getHttpServer())
      .get('/cep/00000-000')
      .set('x-api-key', apiKey)
      .expect(400)
      .expect(({ body }) => {
        if (body.reason !== 'cep_nao_encontrado') throw new Error(`esperado reason cep_nao_encontrado, veio ${body.reason}`);
      });
  });
});
