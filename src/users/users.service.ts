import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { SYSTEM_ROLES, type PermissionKey } from '../common/constants/permissions.constants.js';
import type { AuthenticatedUser } from '../common/types/authenticated-user.js';

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
   */
  async deactivate(id: number): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) {
      throw new NotFoundException('Usuário não encontrado.');
    }

    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id }, data: { isActive: false } }),
      this.prisma.refreshToken.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
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
      permissions: user.role.rolePermissions.map((rp) => rp.permission.key as PermissionKey),
    };
  }
}
