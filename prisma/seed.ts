import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { ROLE_PERMISSIONS, SYSTEM_ROLES } from '../src/common/constants/permissions.constants.js';
import { hashPassword } from '../src/common/utils/password.util.js';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

/**
 * Seed mínimo (RBAC + 1 usuário por papel) — o suficiente para testar
 * login/autorização de ponta a ponta. O plano completo de dados de domínio
 * (2 empresas, 7 vagas, 9 candidaturas, 5 entrevistas, 8 documentos — ver
 * PARECER-DEEPSEEK-FASE1.md §4) entra quando os módulos de Company/Job/
 * Application existirem, para poder ser exercitado pelos endpoints reais
 * em vez de só inserido direto no banco.
 */
async function main() {
  console.log('Seed: criando catálogo de permissões...');

  const permissionKeys = Array.from(new Set(Object.values(ROLE_PERMISSIONS).flat()));

  const permissions = await Promise.all(
    permissionKeys.map((key) =>
      prisma.permission.upsert({
        where: { key },
        update: {},
        create: { key },
      }),
    ),
  );
  const permissionIdByKey = new Map(permissions.map((p) => [p.key, p.id]));

  console.log(`Seed: ${permissions.length} permissões.`);

  console.log('Seed: criando papéis...');

  const roleEntries = await Promise.all(
    Object.values(SYSTEM_ROLES).map((name) =>
      prisma.role.upsert({
        where: { name },
        update: { isSystem: true },
        create: { name, isSystem: true },
      }),
    ),
  );
  const roleByName = new Map(roleEntries.map((r) => [r.name, r]));

  console.log('Seed: associando permissões aos papéis...');

  for (const [roleName, keys] of Object.entries(ROLE_PERMISSIONS)) {
    const role = roleByName.get(roleName)!;
    for (const key of keys) {
      const permissionId = permissionIdByKey.get(key)!;
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId } },
        update: {},
        create: { roleId: role.id, permissionId },
      });
    }
  }

  console.log('Seed: criando um usuário de cada papel (senha: "Senha@123" para todos)...');

  const passwordHash = await hashPassword('Senha@123');

  const admin = await prisma.user.upsert({
    where: { email: 'admin@recrutamento.test' },
    update: {},
    create: {
      name: 'Admin Geral',
      email: 'admin@recrutamento.test',
      password: passwordHash,
      roleId: roleByName.get(SYSTEM_ROLES.ADMIN)!.id,
    },
  });

  const recruiter = await prisma.user.upsert({
    where: { email: 'recrutador@recrutamento.test' },
    update: {},
    create: {
      name: 'Recrutador Um',
      email: 'recrutador@recrutamento.test',
      password: passwordHash,
      roleId: roleByName.get(SYSTEM_ROLES.RECRUITER)!.id,
    },
  });

  const candidate = await prisma.user.upsert({
    where: { email: 'candidato@recrutamento.test' },
    update: {},
    create: {
      name: 'Candidato Um',
      email: 'candidato@recrutamento.test',
      password: passwordHash,
      roleId: roleByName.get(SYSTEM_ROLES.CANDIDATE)!.id,
    },
  });

  console.log('Seed concluído:', {
    admin: admin.email,
    recruiter: recruiter.email,
    candidate: candidate.email,
  });
}

main()
  .catch((error) => {
    console.error('Seed falhou:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
