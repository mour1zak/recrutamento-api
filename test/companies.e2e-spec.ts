import { config as loadEnv } from 'dotenv';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module.js';

loadEnv({ path: process.env.NODE_ENV === 'test' ? '.env.test' : '.env' });

/**
 * Primeiro módulo de domínio além de Auth/Users. Cobre, além do CRUD:
 * a regra de permissão (só ADMIN tem `company:*` fora de `read`), o 409
 * de CNPJ duplicado com o novo formato estruturado ({reason}), o ciclo
 * deactivate/reactivate com os 404 específicos definidos pelo DeepSeek
 * (diferente de User: aqui repetir a operação é erro, não idempotente), e
 * os dois cenários reais de CEP (achado #9 do enunciado — integração
 * externa funcionando e falhando de forma controlada) contra o ViaCEP de
 * verdade, sem mock: um CEP válido conhecido (enriquece o endereço) e um
 * inexistente — que, a partir da rodada 11 (achado Qwen N1), REJEITA a
 * operação com `400` em vez de criar com endereço em branco (só falha de
 * REDE faz isso; CEP explicitamente inválido é erro de quem enviou).
 */
describe('Companies (e2e)', () => {
  let app: INestApplication<App>;
  const apiKey = process.env.API_KEY!;
  const seedPassword = process.env.SEED_USER_PASSWORD ?? 'Senha@123';
  let adminToken: string;
  let recruiterToken: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();

    const [adminLogin, recruiterLogin] = await Promise.all([
      request(app.getHttpServer())
        .post('/auth/login')
        .set('x-api-key', apiKey)
        .send({ email: 'admin@recrutamento.test', password: seedPassword }),
      request(app.getHttpServer())
        .post('/auth/login')
        .set('x-api-key', apiKey)
        .send({ email: 'recrutador@recrutamento.test', password: seedPassword }),
    ]);
    adminToken = adminLogin.body.accessToken;
    recruiterToken = recruiterLogin.body.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  it('RECRUITER (sem company:create) tentando criar empresa -> 403', () => {
    return request(app.getHttpServer())
      .post('/companies')
      .set('x-api-key', apiKey)
      .set('Authorization', `Bearer ${recruiterToken}`)
      .send({ name: 'Empresa X', cep: '01310-100' })
      .expect(403);
  });

  it('POST /companies sem CEP -> 400 (CEP é obrigatório no DTO)', () => {
    return request(app.getHttpServer())
      .post('/companies')
      .set('x-api-key', apiKey)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Empresa sem CEP' })
      .expect(400);
  });

  // Achado Qwen rodada 10 (ressalva 5): esta asserção era estrita
  // (`city` precisava ser exatamente "São Paulo"), dependendo do ViaCEP
  // real responder dentro do timeout — medido pelo Qwen: 2 falhas em ~9
  // execuções completas da suíte, latência de ~1.1s contra timeout de 3s
  // com specs rodando em paralelo. Como `CepService` engole qualquer
  // falha e devolve `null`, uma instabilidade de rede aparecia como
  // "asserção de negócio errada" — o pior diagnóstico possível. Agora só
  // o CONTRATO é verificado aqui (sucesso, nunca bloqueia, CEP salvo); o
  // enriquecimento determinístico já é coberto por `cep.service.spec.ts`
  // com `HttpService` mockado (sucesso e timeout), sem depender do
  // provedor externo estar disponível no instante do teste.
  it('POST /companies com CEP válido (real, sem mock) -> 201, nunca bloqueia mesmo se o provedor estiver instável', async () => {
    const res = await request(app.getHttpServer())
      .post('/companies')
      .set('x-api-key', apiKey)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: `Empresa CEP válido ${Date.now()}`, cep: '01310-100' })
      .expect(201);

    expect(res.body.cep).toBe('01310-100');
    expect(res.body.city === null || typeof res.body.city === 'string').toBe(true);
  });

  // Achado Qwen rodada 11 (N1): antes desta correção, um CEP explicitamente
  // inválido (o provedor confirma que não existe) e uma falha de REDE
  // recebiam o mesmo tratamento ("cria assim mesmo, endereço em branco") —
  // o que permitia, num UPDATE, gravar um `cep` novo com o endereço ANTIGO
  // (achado que o próprio Qwen encontrou na correção da ressalva 1 da
  // rodada 10). Agora só falha de rede não bloqueia; CEP inválido rejeita.
  it('POST /companies com CEP inexistente (real, sem mock) -> 400, rejeitado (achado Qwen rodada 11, N1)', async () => {
    const res = await request(app.getHttpServer())
      .post('/companies')
      .set('x-api-key', apiKey)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: `Empresa CEP inexistente ${Date.now()}`, cep: '00000-000' })
      .expect(400);

    expect(res.body.reason).toBe('cep_nao_encontrado');
  });

  describe('ciclo completo: criar -> ler -> atualizar -> desativar -> reativar', () => {
    const cnpj = `${Date.now()}`.padStart(14, '1').slice(-14);
    let companyId: number;

    it('POST /companies com CNPJ -> 201', async () => {
      // Achado Qwen rodada 11 (N1): `00000-000` era usado aqui só como CEP
      // "descartável" (o foco do teste é CNPJ, não endereço) — mas agora
      // um CEP inexistente rejeita a criação (`400`), então precisa de um
      // CEP real e resolvível, mesmo não sendo o foco do teste.
      const res = await request(app.getHttpServer())
        .post('/companies')
        .set('x-api-key', apiKey)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Empresa Ciclo Completo', cnpj, cep: '01310-100' })
        .expect(201);
      companyId = res.body.id;
    });

    it('POST /companies com o MESMO cnpj de novo -> 409 com reason estruturado', async () => {
      const res = await request(app.getHttpServer())
        .post('/companies')
        .set('x-api-key', apiKey)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Empresa Duplicada', cnpj, cep: '01310-100' })
        .expect(409);

      expect(res.body.reason).toBe('cnpj_duplicado');
    });

    it('GET /companies/:id -> 200', () => {
      return request(app.getHttpServer())
        .get(`/companies/${companyId}`)
        .set('x-api-key', apiKey)
        .set('Authorization', `Bearer ${recruiterToken}`)
        .expect(200);
    });

    it('GET /companies/:id inexistente -> 404', () => {
      return request(app.getHttpServer())
        .get('/companies/999999')
        .set('x-api-key', apiKey)
        .set('Authorization', `Bearer ${recruiterToken}`)
        .expect(404);
    });

    it('PATCH /companies/:id -> 200, nome atualizado', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/companies/${companyId}`)
        .set('x-api-key', apiKey)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Empresa Renomeada' })
        .expect(200);
      expect(res.body.name).toBe('Empresa Renomeada');
    });

    it('PATCH /companies/:id/deactivate -> 200, isActive: false no corpo', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/companies/${companyId}/deactivate`)
        .set('x-api-key', apiKey)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(res.body.isActive).toBe(false);
    });

    it('GET /companies/:id de empresa inativa -> 404 (tratada como inexistente pra leitura)', () => {
      return request(app.getHttpServer())
        .get(`/companies/${companyId}`)
        .set('x-api-key', apiKey)
        .set('Authorization', `Bearer ${recruiterToken}`)
        .expect(404);
    });

    it('PATCH /companies/:id/deactivate de novo -> 409 com reason "company_already_inactive" (achado Qwen rodada 8: era 404, mas o recurso existe)', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/companies/${companyId}/deactivate`)
        .set('x-api-key', apiKey)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(409);
      expect(res.body.reason).toBe('company_already_inactive');
    });

    it('PATCH /companies/:id/reactivate -> 200, isActive: true no corpo', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/companies/${companyId}/reactivate`)
        .set('x-api-key', apiKey)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(res.body.isActive).toBe(true);
    });

    it('PATCH /companies/:id/reactivate de novo -> 409 com reason "company_already_active" (achado Qwen rodada 8: era 404, mas o recurso existe)', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/companies/${companyId}/reactivate`)
        .set('x-api-key', apiKey)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(409);
      expect(res.body.reason).toBe('company_already_active');
    });
  });
});
