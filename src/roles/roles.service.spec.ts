import { describe, expect, it, vi } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { RolesService } from './roles.service.js';
import { PERMISSIONS } from '../common/constants/permissions.constants.js';

// Achado registrado em CONDICOES-ENTRADA-FASE2.md (Gate Nível B, "trava de
// último administrador, mínimo viável"): testado como unidade, não e2e —
// forçar esse estado de verdade contra o banco exigiria tirar
// `role:manage` do papel ADMIN real, mesmo que temporariamente, o que
// arriscaria interferir em specs de outros arquivos rodando contra o
// mesmo banco de teste (ver `test/roles.e2e-spec.ts`).
describe('RolesService.updatePermissions — trava "sem papel com role:manage"', () => {
  function buildPrismaMock(otherGrantsCount: number) {
    return {
      role: { findUnique: vi.fn().mockResolvedValue({ id: 1, name: 'ADMIN' }) },
      permission: {
        findMany: vi.fn().mockResolvedValue([{ id: 10 }]),
        findUnique: vi.fn().mockResolvedValue({ id: 99, key: PERMISSIONS.ROLE_MANAGE }),
      },
      rolePermission: {
        count: vi.fn().mockResolvedValue(otherGrantsCount),
        deleteMany: vi.fn(),
        createMany: vi.fn(),
      },
      $transaction: vi.fn().mockResolvedValue(undefined),
    };
  }

  it('bloqueia com 409 quando NENHUM outro papel tem role:manage', async () => {
    const prisma = buildPrismaMock(0);
    const service = new RolesService(prisma as never);

    const error: ConflictException = await service.updatePermissions(1, [10]).catch((e: unknown) => e as ConflictException);
    expect(error).toBeInstanceOf(ConflictException);
    expect(error.getResponse()).toMatchObject({ reason: 'sem_papel_com_role_manage' });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('permite quando OUTRO papel já tem role:manage', async () => {
    const prisma = buildPrismaMock(1);
    // `findOne()` roda no final do método com sucesso — mocka o retorno
    // completo que ele precisa (`select` com `rolePermissions` aninhado).
    prisma.role.findUnique = vi
      .fn()
      .mockResolvedValueOnce({ id: 1, name: 'ADMIN' })
      .mockResolvedValueOnce({ id: 1, name: 'ADMIN', description: null, isSystem: true, rolePermissions: [] });
    const service = new RolesService(prisma as never);

    const result = await service.updatePermissions(1, [10]);
    expect(prisma.$transaction).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ id: 1, name: 'ADMIN' });
  });
});
