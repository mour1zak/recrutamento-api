import { config as loadEnv } from 'dotenv';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { PERMISSIONS, SYSTEM_ROLES } from '../src/common/constants/permissions.constants.js';

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

  /**
   * Cobre o achado crítico Qwen rodada 5 (N1): o último ADMIN conseguia
   * se autodesativar (ou ser desativado, ficando o sistema sem
   * administrador), sem nenhuma rota de reversão pela API.
   */
  describe('trava de último administrador (N1, rodada 5)', () => {
    it('ADMIN tenta desativar a própria conta -> 409', async () => {
      const login = await request(app.getHttpServer())
        .post('/auth/login')
        .set('x-api-key', apiKey)
        .send({ email: 'admin@recrutamento.test', password: seedPassword })
        .expect(200);

      return request(app.getHttpServer())
        .patch(`/users/${login.body.user.id}/deactivate`)
        .set('x-api-key', apiKey)
        .set('Authorization', `Bearer ${login.body.accessToken}`)
        .expect(409);
    });

    it('desativar o único ADMIN ativo restante -> 409, mesmo vindo de outro papel com user:manage', async () => {
      const prisma = app.get(PrismaService);

      // Simula o estado que o Nível B (edição de permissões em runtime,
      // FEEDBACKS-MELHORIA.md) poderia produzir: um papel diferente de
      // ADMIN ganhando `user:manage`. Isso prova que a trava é do NÚMERO
      // de admins ativos, não "só ADMIN nunca desativa outro ADMIN".
      const [adminRole, candidateRole, userManagePermission] = await Promise.all([
        prisma.role.findUniqueOrThrow({ where: { name: SYSTEM_ROLES.ADMIN } }),
        prisma.role.findUniqueOrThrow({ where: { name: SYSTEM_ROLES.CANDIDATE } }),
        prisma.permission.findUniqueOrThrow({ where: { key: PERMISSIONS.USER_MANAGE } }),
      ]);

      const grant = await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: candidateRole.id, permissionId: userManagePermission.id } },
        update: {},
        create: { roleId: candidateRole.id, permissionId: userManagePermission.id },
      });

      const soleAdmin = await prisma.user.findFirstOrThrow({ where: { roleId: adminRole.id } });

      try {
        const login = await request(app.getHttpServer())
          .post('/auth/login')
          .set('x-api-key', apiKey)
          .send({ email: 'candidato@recrutamento.test', password: seedPassword })
          .expect(200);

        // Confirma a premissa do teste: existe exatamente 1 ADMIN ativo.
        const activeAdmins = await prisma.user.count({ where: { roleId: adminRole.id, isActive: true } });
        expect(activeAdmins).toBe(1);

        return await request(app.getHttpServer())
          .patch(`/users/${soleAdmin.id}/deactivate`)
          .set('x-api-key', apiKey)
          .set('Authorization', `Bearer ${login.body.accessToken}`)
          .expect(409);
      } finally {
        // Desfaz a simulação — nunca deixar `user:manage` concedido a
        // CANDIDATE fora deste teste.
        await prisma.rolePermission.delete({ where: { id: grant.id } });
      }
    });

    /**
     * Achado crítico Qwen rodada 6 (N1-a): a trava de "último admin" usa
     * uma transação `Serializable`, e duas transações concorrentes que
     * conflitam nela produziam um `500` cru em 67% das corridas medidas
     * (o conflito de serialização do driver adapter não tinha o formato
     * que o filtro de exceções antigo reconhecia). Este teste dispara
     * várias desativações mútuas simultâneas — o cenário que gera
     * contenção real no agregado "quantos admins estão ativos" — e
     * garante que toda resposta é `204` ou `409`, nunca `500`.
     */
    it('desativações mútuas simultâneas entre vários admins nunca respondem 500', async () => {
      const prisma = app.get(PrismaService);
      const adminRole = await prisma.role.findUniqueOrThrow({ where: { name: SYSTEM_ROLES.ADMIN } });
      const passwordHash = await prisma.user
        .findFirstOrThrow({ where: { roleId: adminRole.id }, select: { password: true } })
        .then((u) => u.password);

      const PAIR_COUNT = 4; // 8 admins temporários, 4 pares se desativando ao mesmo tempo
      const tempAdmins = await Promise.all(
        Array.from({ length: PAIR_COUNT * 2 }, (_, i) =>
          prisma.user.create({
            data: {
              name: `Admin Concorrência ${i} (teste)`,
              email: `admin-concorrencia-${Date.now()}-${i}@example.com`,
              password: passwordHash,
              roleId: adminRole.id,
            },
          }),
        ),
      );

      try {
        const logins = await Promise.all(
          tempAdmins.map((u) =>
            request(app.getHttpServer())
              .post('/auth/login')
              .set('x-api-key', apiKey)
              .send({ email: u.email, password: seedPassword })
              .expect(200),
          ),
        );

        // Cada admin[2i] desativa admin[2i+1] e vice-versa, tudo ao mesmo
        // tempo — maximiza a chance de duas transações Serializable
        // conflitarem de verdade na contagem agregada de admins ativos.
        const requests: Promise<{ status: number; body: unknown }>[] = [];
        for (let i = 0; i < PAIR_COUNT; i++) {
          const a = 2 * i;
          const b = 2 * i + 1;
          requests.push(
            request(app.getHttpServer())
              .patch(`/users/${tempAdmins[b].id}/deactivate`)
              .set('x-api-key', apiKey)
              .set('Authorization', `Bearer ${logins[a].body.accessToken}`)
              .then((res) => ({ status: res.status, body: res.body })),
          );
          requests.push(
            request(app.getHttpServer())
              .patch(`/users/${tempAdmins[a].id}/deactivate`)
              .set('x-api-key', apiKey)
              .set('Authorization', `Bearer ${logins[b].body.accessToken}`)
              .then((res) => ({ status: res.status, body: res.body })),
          );
        }

        const results = await Promise.all(requests);

        const statuses = results.map((r) => r.status);
        const has500 = statuses.some((s) => s >= 500);
        if (has500) {
          // eslint-disable-next-line no-console -- diagnóstico só quando falha
          console.error('Respostas 5xx encontradas:', JSON.stringify(results, null, 2));
        }
        expect(has500).toBe(false);
        expect(statuses.every((s) => s === 204 || s === 409)).toBe(true);

        // Nunca zero admins ativos, mesmo sob essa carga.
        const activeAdminsAfter = await prisma.user.count({ where: { roleId: adminRole.id, isActive: true } });
        expect(activeAdminsAfter).toBeGreaterThan(0);
      } finally {
        await prisma.refreshToken.deleteMany({ where: { userId: { in: tempAdmins.map((u) => u.id) } } });
        await prisma.user.deleteMany({ where: { id: { in: tempAdmins.map((u) => u.id) } } });
      }
    });
  });
});
