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
 * RBAC Nível B. Testado só com um papel CUSTOM criado pra este arquivo
 * (nunca `ADMIN`/`RECRUITER`/`CANDIDATE` do seed) — mexer nas permissões
 * dos 3 papéis reais afetaria toda a suíte, que roda outros specs
 * assumindo esse estado. A trava "sem papel nenhum com role:manage"
 * (Gate Nível B) é testada como unidade (`roles.service.spec.ts`), não
 * aqui, pelo mesmo motivo: forçar esse estado de verdade exigiria tirar
 * `role:manage` do ADMIN real, mesmo que temporariamente.
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
});
