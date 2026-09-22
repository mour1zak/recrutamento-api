import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { errorBody } from '../common/exceptions/error-body.util.js';
import { PERMISSIONS } from '../common/constants/permissions.constants.js';

const ROLE_WITH_PERMISSIONS_SELECT = {
  id: true,
  name: true,
  description: true,
  isSystem: true,
  rolePermissions: { select: { permission: { select: { id: true, key: true, description: true } } } },
} as const;

function roleNotFound() {
  return new NotFoundException(errorBody(404, 'role_not_found', 'Papel não encontrado.'));
}

function toRoleResponse(role: {
  id: number;
  name: string;
  description: string | null;
  isSystem: boolean;
  rolePermissions: { permission: { id: number; key: string; description: string | null } }[];
}) {
  const { rolePermissions, ...rest } = role;
  return { ...rest, permissions: rolePermissions.map((rp) => rp.permission) };
}

/**
 * RBAC Nível B (decisão explícita da Fase 1 de assumir o custo — ver
 * `FASE-1-MODELAGEM.md` §5.1): editar em runtime quais permissões cada
 * papel tem, sem precisar de deploy. Só 3 rotas — `DELETE /roles/:id`
 * nunca existiu no mapa do DeepSeek e não é exposto aqui de propósito
 * (mesma lógica de `job:delete` reservado em Jobs): apagar um papel dos
 * 3 do enunciado quebraria o RBAC inteiro, e `isSystem` (schema, Fase 1)
 * não tem nenhum código que dependa dele além de existir — não precisa
 * proteger uma operação (rename/delete de Role) que este módulo nunca
 * expõe.
 */
@Injectable()
export class RolesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    const roles = await this.prisma.role.findMany({ select: ROLE_WITH_PERMISSIONS_SELECT, orderBy: { id: 'asc' } });
    return roles.map(toRoleResponse);
  }

  async findOne(id: number) {
    const role = await this.prisma.role.findUnique({ where: { id }, select: ROLE_WITH_PERMISSIONS_SELECT });
    if (!role) {
      throw roleNotFound();
    }
    return toRoleResponse(role);
  }

  async updatePermissions(id: number, permissionIds: number[]) {
    const role = await this.prisma.role.findUnique({ where: { id } });
    if (!role) {
      throw roleNotFound();
    }

    if (permissionIds.length > 0) {
      const found = await this.prisma.permission.findMany({ where: { id: { in: permissionIds } }, select: { id: true } });
      if (found.length !== permissionIds.length) {
        throw new BadRequestException(errorBody(400, 'permission_id_invalido', 'Um ou mais permissionIds não existem no catálogo.'));
      }
    }

    // Achado CRÍTICO Qwen rodada 12 (K2): a versão anterior fazia a
    // contagem de "outros papéis com role:manage" FORA da transação de
    // escrita — duas requisições `PUT` simultâneas em papéis DIFERENTES,
    // cada uma removendo `role:manage` do seu próprio papel, contavam
    // "o outro papel ainda tem" ao mesmo tempo, as duas viam "sobra
    // alguém" e as duas escreviam. Medido: 10 em 12 corridas deixaram o
    // sistema com ZERO papéis com `role:manage` — um estado
    // irrecuperável pela API (a própria rota que desfaria isso exige a
    // permissão que acabou de sumir). Corrigido envolvendo a contagem E
    // a escrita na MESMA transação `Serializable` — mesmo padrão já
    // provado em `UsersService.deactivate()` (rodada 5/6): o Postgres
    // detecta a dependência entre as duas transações concorrentes e
    // aborta uma delas com conflito de serialização, que o
    // `GlobalExceptionFilter` já traduz para `409` desde a rodada 6.
    await this.prisma.$transaction(
      async (tx) => {
        const roleManagePermission = await tx.permission.findUnique({ where: { key: PERMISSIONS.ROLE_MANAGE } });
        if (roleManagePermission && !permissionIds.includes(roleManagePermission.id)) {
          const otherGrants = await tx.rolePermission.count({
            where: { permissionId: roleManagePermission.id, roleId: { not: id } },
          });
          if (otherGrants === 0) {
            throw new ConflictException(
              errorBody(409, 'sem_papel_com_role_manage', 'Esta mudança deixaria o sistema sem nenhum papel com "role:manage" — ninguém mais conseguiria gerenciar papéis depois.'),
            );
          }
        }

        // Achado registrado, não corrigido agora (custo de uma migration
        // nova fora do orçamento de tempo restante): a revogação aqui é
        // destrutiva (`deleteMany` + `createMany`), não soft-delete com
        // autor — Gate Nível B pede o soft-delete pra auditar QUEM
        // revogou o quê e QUANDO; hoje só o estado final fica
        // registrado, o histórico da mudança em si não.
        await tx.rolePermission.deleteMany({ where: { roleId: id } });
        if (permissionIds.length > 0) {
          await tx.rolePermission.createMany({ data: permissionIds.map((permissionId) => ({ roleId: id, permissionId })) });
        }
      },
      { isolationLevel: 'Serializable' },
    );

    return this.findOne(id);
  }
}
