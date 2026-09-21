import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { PERMISSIONS, SYSTEM_ROLES, type PermissionKey } from '../common/constants/permissions.constants.js';
import type { AuthenticatedUser } from '../common/types/authenticated-user.js';

const KNOWN_PERMISSION_KEYS = new Set<string>(Object.values(PERMISSIONS));
// Achado Qwen rodada 6 (ressalva 10): sem isso, uma key órfã no banco loga
// um aviso a CADA request autenticado (toAuthenticatedUser roda em todo
// findAuthenticatedById) — um aviso por processo é suficiente.
const WARNED_ORPHAN_KEYS = new Set<string>();

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
   * CORREÇÃO DE DESCRIÇÃO (achado Qwen rodada 6, N1-d): a versão anterior
   * deste comentário afirmava que o conflito de duas transações
   * concorrentes viraria `P2034`, mapeado para `409` pelo filtro. **Isso
   * era falso.** Medido por execução: com driver adapter (obrigatório no
   * Prisma 7), o conflito de serialização chega como um `DriverAdapterError`
   * (`cause.kind === 'TransactionWriteConflict'`), não como
   * `PrismaClientKnownRequestError` com `code: 'P2034'` — o filtro antigo
   * nunca via esse erro, e ele caía como `500` cru em 67% das corridas
   * medidas. Corrigido no `GlobalExceptionFilter`
   * (`src/common/filters/global-exception.filter.ts`), que reconhece esse
   * formato por duck-typing e devolve `409`.
   *
   * DECISÃO DE DESENHO (N1-b): mantivemos `Serializable` em vez de trocar
   * para o padrão de `UPDATE` condicional + `count` usado no `refresh()`
   * (C4, rodada 4) — que teria o mesmo efeito sem abortar transação nenhuma.
   * `Serializable` foi mantido porque, com o `GlobalExceptionFilter`
   * corrigido, o custo do abort (a transação perdedora relança a
   * exceção, que agora vira `409` corretamente) é aceitável para uma
   * operação de baixa frequência como desativar usuário — e a checagem
   * ("ninguém pode ficar sem admin") depende de um agregado (`count`)
   * sobre múltiplas linhas, não de uma única linha como o `filledCount`,
   * o que tornaria o padrão condicional mais complexo de expressar aqui.
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

  /**
   * Operação inversa de `deactivate()` — achado Qwen rodada 6 (N1-c):
   * antes desta rota, desativar um usuário era irreversível pela API. Sem
   * trava especial: reativar não corre risco de "zerar admins" (é o
   * caminho oposto), e não há problema em reativar alguém que já está
   * ativo (idempotente, mesmo padrão de `deactivate`, já validado por
   * auditoria).
   */
  async reactivate(targetId: number): Promise<void> {
    const target = await this.prisma.user.findUnique({ where: { id: targetId } });
    if (!target) {
      throw new NotFoundException('Usuário não encontrado.');
    }
    await this.prisma.user.update({ where: { id: targetId }, data: { isActive: true } });
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
          if (!known && !WARNED_ORPHAN_KEYS.has(key)) {
            WARNED_ORPHAN_KEYS.add(key);
            this.logger.warn(`Permission key "${key}" concedida no banco não existe no catálogo (permissions.constants.ts).`);
          }
          return known;
        }),
    };
  }
}
