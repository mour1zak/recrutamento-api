import { config as loadEnv } from 'dotenv';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { PERMISSIONS } from '../src/common/constants/permissions.constants.js';

loadEnv({ path: process.env.NODE_ENV === 'test' ? '.env.test' : '.env' });

/**
 * RBAC Nível B. A maior parte dos testes usa só um papel CUSTOM (nunca
 * `ADMIN`/`RECRUITER`/`CANDIDATE` do seed) — mexer nas permissões dos 3
 * papéis reais afetaria toda a suíte. A EXCEÇÃO é o teste de concorrência
 * do K2 (achado Qwen rodada 12): provar a trava "sem papel nenhum com
 * role:manage" de verdade exige tirar `role:manage` do ADMIN
 * temporariamente — feito com `try/finally` restaurando o estado
 * original, e seguro porque nenhum outro arquivo de teste chama rotas
 * `role:manage` além deste.
 */
describe('Roles / RBAC Nível B (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const apiKey = process.env.API_KEY!;
  const seedPassword = process.env.SEED_USER_PASSWORD ?? 'Senha@123';

  let adminToken: string;
  let candidateToken: string;
  let customRoleId: number;
  let jobReadPermissionId: number;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);

    const [adminLogin, candidateLogin, jobReadPermission] = await Promise.all([
      request(app.getHttpServer()).post('/auth/login').set('x-api-key', apiKey).send({ email: 'admin@recrutamento.test', password: seedPassword }),
      request(app.getHttpServer()).post('/auth/login').set('x-api-key', apiKey).send({ email: 'candidato@recrutamento.test', password: seedPassword }),
      prisma.permission.findUniqueOrThrow({ where: { key: PERMISSIONS.JOB_READ } }),
    ]);
    adminToken = adminLogin.body.accessToken;
    candidateToken = candidateLogin.body.accessToken;
    jobReadPermissionId = jobReadPermission.id;

    const customRole = await prisma.role.create({ data: { name: `TESTE_NIVEL_B_${Date.now()}`, description: 'Papel custom só deste teste' } });
    customRoleId = customRole.id;
  });

  afterAll(async () => {
    await prisma.rolePermission.deleteMany({ where: { roleId: customRoleId } });
    await prisma.role.delete({ where: { id: customRoleId } });
    await app.close();
  });

  it('GET /roles (sem role:manage) -> 403', () => {
    return request(app.getHttpServer()).get('/roles').set('x-api-key', apiKey).set('Authorization', `Bearer ${candidateToken}`).expect(403);
  });

  it('GET /roles (ADMIN) -> 200, inclui os 3 papéis do seed com permissions[]', async () => {
    const res = await request(app.getHttpServer()).get('/roles').set('x-api-key', apiKey).set('Authorization', `Bearer ${adminToken}`).expect(200);
    const names = res.body.map((r: { name: string }) => r.name);
    expect(names).toEqual(expect.arrayContaining(['ADMIN', 'RECRUITER', 'CANDIDATE']));
    const admin = res.body.find((r: { name: string }) => r.name === 'ADMIN');
    expect(Array.isArray(admin.permissions)).toBe(true);
    expect(admin.permissions.length).toBeGreaterThan(0);
  });

  it('GET /roles/:id inexistente -> 404', () => {
    return request(app.getHttpServer()).get('/roles/999999').set('x-api-key', apiKey).set('Authorization', `Bearer ${adminToken}`).expect(404);
  });

  it('PUT /roles/:id/permissions com permissionId inexistente -> 400', async () => {
    const res = await request(app.getHttpServer())
      .put(`/roles/${customRoleId}/permissions`)
      .set('x-api-key', apiKey)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ permissionIds: [999999] })
      .expect(400);
    expect(res.body.reason).toBe('permission_id_invalido');
  });

  it('PUT /roles/:id/permissions em papel inexistente -> 404', () => {
    return request(app.getHttpServer())
      .put('/roles/999999/permissions')
      .set('x-api-key', apiKey)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ permissionIds: [] })
      .expect(404);
  });

  it('PUT /roles/:id/permissions (papel custom, conjunto válido) -> 200, substitui de verdade', async () => {
    const res = await request(app.getHttpServer())
      .put(`/roles/${customRoleId}/permissions`)
      .set('x-api-key', apiKey)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ permissionIds: [jobReadPermissionId] })
      .expect(200);
    expect(res.body.permissions).toHaveLength(1);
    expect(res.body.permissions[0].key).toBe(PERMISSIONS.JOB_READ);

    // Substitui de novo por um conjunto vazio — revoga tudo, sem sobrar
    // resíduo da atribuição anterior (prova que é substituição, não soma).
    const res2 = await request(app.getHttpServer())
      .put(`/roles/${customRoleId}/permissions`)
      .set('x-api-key', apiKey)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ permissionIds: [] })
      .expect(200);
    expect(res2.body.permissions).toHaveLength(0);
  });

  it('mudança de permissão tem efeito imediato num usuário existente do papel (sem re-login)', async () => {
    await request(app.getHttpServer())
      .put(`/roles/${customRoleId}/permissions`)
      .set('x-api-key', apiKey)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ permissionIds: [jobReadPermissionId] })
      .expect(200);

    const someHash = await prisma.user.findFirstOrThrow({ where: { email: 'admin@recrutamento.test' }, omit: { password: false } }).then((u) => u.password);
    const tempUser = await prisma.user.create({ data: { name: 'Usuário Nível B', email: `usuario-nivel-b-${Date.now()}@example.com`, password: someHash, roleId: customRoleId } });
    const login = await request(app.getHttpServer()).post('/auth/login').set('x-api-key', apiKey).send({ email: tempUser.email, password: seedPassword });
    const token = login.body.accessToken;

    // `job:read` já concedido -> `GET /jobs/:id` (mesmo sem a vaga
    // existir, `job:read` basta pra passar do PermissionsGuard) não pode
    // dar 403.
    const before = await request(app.getHttpServer()).get('/jobs/999999').set('x-api-key', apiKey).set('Authorization', `Bearer ${token}`);
    expect(before.status).not.toBe(403);

    // Revoga em runtime, SEM o usuário fazer logout/login de novo — o
    // `JwtStrategy` recalcula permissões do banco a cada request (Fase 2),
    // então o efeito é imediato, sem depender de reemitir o token.
    await request(app.getHttpServer()).put(`/roles/${customRoleId}/permissions`).set('x-api-key', apiKey).set('Authorization', `Bearer ${adminToken}`).send({ permissionIds: [] }).expect(200);

    const after = await request(app.getHttpServer()).get('/jobs/999999').set('x-api-key', apiKey).set('Authorization', `Bearer ${token}`);
    expect(after.status).toBe(403);

    await prisma.refreshToken.deleteMany({ where: { userId: tempUser.id } });
    await prisma.user.delete({ where: { id: tempUser.id } });
  });

  // Achado CRÍTICO Qwen rodada 12 (K2): a contagem de "outros papéis com
  // role:manage" acontecia FORA da transação de escrita — duas
  // requisições concorrentes em papéis diferentes, cada uma vendo "o
  // outro ainda tem", podiam ambas zerar a permissão do sistema inteiro
  // (medido: 10/12 corridas). Corrigido envolvendo contagem + escrita na
  // mesma transação `Serializable`. Provar isso de verdade exige um
  // estado onde SÓ dois papéis têm `role:manage` — inclusive tirando do
  // ADMIN temporariamente, com restauração garantida em `finally` (nenhum
  // outro arquivo de teste usa rotas `role:manage` além deste).
  it('duas requisições PUT simultâneas em papéis diferentes removendo role:manage nunca zeram o sistema inteiro', async () => {
    const roleManagePermission = await prisma.permission.findUniqueOrThrow({ where: { key: PERMISSIONS.ROLE_MANAGE } });
    const originalGrants = await prisma.rolePermission.findMany({ where: { permissionId: roleManagePermission.id } });

    const [roleA, roleB] = await Promise.all([
      prisma.role.create({ data: { name: `K2_ROLE_A_${Date.now()}` } }),
      prisma.role.create({ data: { name: `K2_ROLE_B_${Date.now()}` } }),
    ]);
    const someHash = await prisma.user.findFirstOrThrow({ where: { email: 'admin@recrutamento.test' }, omit: { password: false } }).then((u) => u.password);
    const [userA, userB] = await Promise.all([
      prisma.user.create({ data: { name: 'K2 User A', email: `k2-user-a-${Date.now()}@example.com`, password: someHash, roleId: roleA.id } }),
      prisma.user.create({ data: { name: 'K2 User B', email: `k2-user-b-${Date.now()}@example.com`, password: someHash, roleId: roleB.id } }),
    ]);

    try {
      const ROUNDS = 5;
      for (let round = 0; round < ROUNDS; round++) {
        // Estado limítrofe: SÓ A e B têm role:manage (ninguém mais,
        // nem ADMIN) — é exatamente essa condição que expõe a corrida.
        await prisma.rolePermission.deleteMany({ where: { permissionId: roleManagePermission.id } });
        await prisma.rolePermission.createMany({
          data: [
            { roleId: roleA.id, permissionId: roleManagePermission.id },
            { roleId: roleB.id, permissionId: roleManagePermission.id },
          ],
        });

        const [loginA, loginB] = await Promise.all([
          request(app.getHttpServer()).post('/auth/login').set('x-api-key', apiKey).send({ email: userA.email, password: seedPassword }),
          request(app.getHttpServer()).post('/auth/login').set('x-api-key', apiKey).send({ email: userB.email, password: seedPassword }),
        ]);

        const [resA, resB] = await Promise.all([
          request(app.getHttpServer()).put(`/roles/${roleA.id}/permissions`).set('x-api-key', apiKey).set('Authorization', `Bearer ${loginA.body.accessToken}`).send({ permissionIds: [] }),
          request(app.getHttpServer()).put(`/roles/${roleB.id}/permissions`).set('x-api-key', apiKey).set('Authorization', `Bearer ${loginB.body.accessToken}`).send({ permissionIds: [] }),
        ]);

        expect([resA.status, resB.status].every((s) => s === 200 || s === 409)).toBe(true);
        // Achado Qwen rodada 13 (ressalva 1): o 409 de conflito de
        // serialização é o desfecho mais comum desta corrida e agora
        // precisa vir com `reason` — sem isso era o único 409 de domínio
        // do projeto sem um.
        for (const res of [resA, resB]) {
          if (res.status === 409) {
            expect(res.body.reason).toBe('concorrencia_transacao');
          }
        }
        const remaining = await prisma.rolePermission.count({ where: { permissionId: roleManagePermission.id } });
        // O invariante que importa: nunca ZERO. Não "exatamente um 200"
        // (as duas podem legitimamente falhar se o Postgres abortar as
        // duas por deadlock detection em vez de serialization failure —
        // o que importa é que o estado final nunca fica sem ninguém.
        expect(remaining).toBeGreaterThanOrEqual(1);
      }
    } finally {
      // Restaura o estado original de `role:manage` (inclusive o do
      // ADMIN) antes de limpar os papéis/usuários criados neste teste.
      await prisma.rolePermission.deleteMany({ where: { permissionId: roleManagePermission.id } });
      if (originalGrants.length > 0) {
        await prisma.rolePermission.createMany({ data: originalGrants.map((g) => ({ roleId: g.roleId, permissionId: g.permissionId })) });
      }
      await prisma.refreshToken.deleteMany({ where: { userId: { in: [userA.id, userB.id] } } });
      await prisma.user.deleteMany({ where: { id: { in: [userA.id, userB.id] } } });
      await prisma.rolePermission.deleteMany({ where: { roleId: { in: [roleA.id, roleB.id] } } });
      await prisma.role.deleteMany({ where: { id: { in: [roleA.id, roleB.id] } } });
    }
  });
});
