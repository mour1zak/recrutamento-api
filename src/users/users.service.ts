import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { PERMISSIONS, SYSTEM_ROLES, type PermissionKey } from '../common/constants/permissions.constants.js';
import type { AuthenticatedUser } from '../common/types/authenticated-user.js';

const KNOWN_PERMISSION_KEYS = new Set<string>(Object.values(PERMISSIONS));

// select nomeado, sem password — mesmo padrão validado na auditoria do
// DEVCONNECT (FASE-1-MODELAGEM.md §7.2): nunca depender de lembrar de
// excluir campos sensíveis em cada query manualmente.
const authUserSelect = {
  id: true,
  email: true,
  name: true,
  isActive: true,
  roleId: true,
  companyId: true,
  role: {
    select: {
      name: true,
      rolePermissions: {
        select: { permission: { select: { key: true } } },
      },
    },
  },
} as const;

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(private readonly prisma: PrismaService) {}

  async findAuthenticatedById(id: number): Promise<AuthenticatedUser | null> {
    const user = await this.prisma.user.findUnique({ where: { id }, select: authUserSelect });
    if (!user || !user.isActive) {
      return null;
    }
    return this.toAuthenticatedUser(user);
  }

  async findByEmailForLogin(email: string) {
    // Override pontual do `omit` global: login é o único lugar que
    // legitimamente precisa do hash da senha, para comparar com bcrypt.
    return this.prisma.user.findUnique({
      where: { email: normalizeEmail(email) },
      include: { role: true },
      omit: { password: false },
    });
  }

  async createCandidate(data: { name: string; email: string; passwordHash: string }) {
    const email = normalizeEmail(data.email);

    const candidateRole = await this.prisma.role.findUnique({
      where: { name: SYSTEM_ROLES.CANDIDATE },
    });
    if (!candidateRole) {
      // Erro de configuração do servidor (seed não rodou), não erro do
      // cliente — 500 é o código correto aqui, ao contrário de erros de
      // negócio previstos.
      throw new Error('Papel CANDIDATE não encontrado — o seed foi executado?');
    }

    // Sem checagem prévia de "email já existe" (achado Qwen rodada 4, R2):
    // aquele padrão era check-then-create, com a mesma janela de corrida
    // do C4. O `@@unique(email)` do banco já garante a regra; deixamos o
    // Postgres recusar e o PrismaExceptionFilter global traduz o P2002
    // para 409 — uma fonte de verdade, sem janela de corrida.
    const user = await this.prisma.user.create({
      data: {
        name: data.name,
        email,
        password: data.passwordHash,
        roleId: candidateRole.id,
      },
      select: authUserSelect,
    });

    return this.toAuthenticatedUser(user);
  }

  /**
   * Única forma suportada de "remover" um usuário (R-C4.1/2,
   * CONDICOES-ENTRADA-FASE2.md) — nunca DELETE físico. Revoga também todos
   * os refresh tokens ativos, para que uma sessão já aberta não continue
   * renovável depois da desativação.
   *
   * Corrige achado crítico Qwen rodada 5 (N1): o último ADMIN conseguia
   * desativar a si mesmo (ou outro admin), zerando os administradores
   * ativos sem nenhuma rota de reversão — estado irrecuperável pela API.
   * Duas travas: (1) ninguém desativa a própria conta; (2) não é permitido
   * ficar com zero ADMIN ativo.
   *
   * As duas travas rodam dentro de uma transação `Serializable`, não só um
   * `if` antes do `update`: um `count()` de admins ativos seguido de um
   * `update` em passos separados teria a mesma janela de corrida que o C4
   * (rodada 4) já corrigiu em outro lugar — dois admins se desativando ao
   * mesmo tempo poderiam ambos ler "sobra mais de um" antes de qualquer um
   * escrever. `Serializable` faz o Postgres abortar uma das duas transações
   * concorrentes (vira `P2034`, já mapeado para `409` pelo
   * `PrismaExceptionFilter`) em vez de deixar as duas passarem.
   */
  async deactivate(targetId: number, currentUserId: number): Promise<void> {
    if (targetId === currentUserId) {
      throw new ConflictException('Você não pode desativar a própria conta.');
    }

    await this.prisma.$transaction(
      async (tx) => {
        const target = await tx.user.findUnique({
          where: { id: targetId },
          include: { role: true },
        });
        if (!target) {
          throw new NotFoundException('Usuário não encontrado.');
        }

        if (target.role.name === SYSTEM_ROLES.ADMIN && target.isActive) {
          const activeAdmins = await tx.user.count({
            where: { isActive: true, role: { name: SYSTEM_ROLES.ADMIN } },
          });
          if (activeAdmins <= 1) {
            throw new ConflictException('Não é possível desativar o último administrador ativo.');
          }
        }

        await tx.user.update({ where: { id: targetId }, data: { isActive: false } });
        await tx.refreshToken.updateMany({
          where: { userId: targetId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      },
      { isolationLevel: 'Serializable' },
    );
  }

  private toAuthenticatedUser(user: {
    id: number;
    email: string;
    name: string;
    roleId: number;
    companyId: number | null;
    role: { name: string; rolePermissions: { permission: { key: string } }[] };
  }): AuthenticatedUser {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      roleId: user.roleId,
      roleName: user.role.name,
      companyId: user.companyId,
      // Achado Qwen rodada 5 (N13): antes era um `as PermissionKey` cego —
      // uma key gravada no banco fora do catálogo (seed divergente, ou um
      // futuro Nível B editando permissões livremente) entraria em
      // `user.permissions` sem nenhum aviso. Uma key órfã aqui é inofensiva
      // por si só (o Guard só confere `includes`), mas é sintoma de algo
      // errado no catálogo/seed — vale logar, não silenciar.
      permissions: user.role.rolePermissions
        .map((rp) => rp.permission.key)
        .filter((key): key is PermissionKey => {
          const known = KNOWN_PERMISSION_KEYS.has(key);
          if (!known) {
            this.logger.warn(`Permission key "${key}" concedida no banco não existe no catálogo (permissions.constants.ts).`);
          }
          return known;
        }),
    };
  }
}
