import { describe, expect, it, vi } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { RolesService } from './roles.service.js';
import { PERMISSIONS } from '../common/constants/permissions.constants.js';

// Achado CRÍTICO Qwen rodada 12 (K2): a versão anterior contava "outros
// papéis com role:manage" FORA da transação de escrita — duas
// requisições concorrentes em papéis diferentes podiam ambas ver "sobra
// alguém" e ambas escrever, zerando `role:manage` do sistema (medido:
// 10/12 corridas). Corrigido envolvendo contagem + escrita na mesma
// `$transaction(callback, {isolationLevel: 'Serializable'})` — o mock
// abaixo prova que o CÓDIGO está estruturalmente correto (contagem e
// escrita na mesma transação). A prova de que o Postgres real detecta e
// aborta a corrida está em `test/roles.e2e-spec.ts` (concorrência real,
// 5 rodadas, papel ADMIN temporariamente sem `role:manage` com
// restauração garantida).
describe('RolesService.updatePermissions — trava "sem papel com role:manage"', () => {
  function buildPrismaMock(otherGrantsCount: number) {
    const tx = {
      permission: {
        findUnique: vi.fn().mockResolvedValue({ id: 99, key: PERMISSIONS.ROLE_MANAGE }),
      },
      rolePermission: {
        count: vi.fn().mockResolvedValue(otherGrantsCount),
        deleteMany: vi.fn(),
        createMany: vi.fn(),
      },
    };
    return {
      role: { findUnique: vi.fn().mockResolvedValue({ id: 1, name: 'ADMIN' }) },
      permission: { findMany: vi.fn().mockResolvedValue([{ id: 10 }]) },
      $transaction: vi.fn().mockImplementation((callback: (tx: unknown) => unknown) => callback(tx)),
      __tx: tx,
    };
  }

  it('bloqueia com 409 quando NENHUM outro papel tem role:manage', async () => {
    const prisma = buildPrismaMock(0);
    const service = new RolesService(prisma as never);

    const error: ConflictException = await service.updatePermissions(1, [10]).catch((e: unknown) => e as ConflictException);
    expect(error).toBeInstanceOf(ConflictException);
    expect(error.getResponse()).toMatchObject({ reason: 'sem_papel_com_role_manage' });
    expect(prisma.__tx.rolePermission.deleteMany).not.toHaveBeenCalled();
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
    expect(prisma.__tx.rolePermission.deleteMany).toHaveBeenCalledOnce();
    expect(prisma.__tx.rolePermission.createMany).toHaveBeenCalledOnce();
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'Serializable' });
    expect(result).toMatchObject({ id: 1, name: 'ADMIN' });
  });
});
