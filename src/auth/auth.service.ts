import { createHash, randomBytes } from 'node:crypto';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service.js';
import { UsersService } from '../users/users.service.js';
import { parseDurationToMs } from '../common/utils/duration.util.js';
import { hashPassword, verifyPassword } from '../common/utils/password.util.js';
import type { RegisterDto } from './dto/register.dto.js';
import type { LoginDto } from './dto/login.dto.js';

interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

// Hash bcrypt válido (de uma senha descartável, nunca usada de verdade) só
// para gastar o mesmo tempo de CPU quando o email não existe. Corrige
// achado da auditoria Qwen rodada 4 (P4, medido por execução): sem isso,
// "usuário não existe" respondia em ~0ms e "senha errada" em ~72ms — a
// mensagem de erro era genérica, mas o TEMPO não era, permitindo descobrir
// quais emails estão cadastrados só medindo latência.
const DUMMY_PASSWORD_HASH = '$2b$10$n0iH0FWwE10aw.LGHLHMOO6dsOxIqZ1YJOIzzuI1LE6zAnQ6fyN7y';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async register(dto: RegisterDto) {
    const passwordHash = await hashPassword(dto.password);
    const user = await this.usersService.createCandidate({
      name: dto.name,
      email: dto.email,
      passwordHash,
    });
    const tokens = await this.issueTokenPair(user.id);
    return { user: this.toPublicUser(user), ...tokens };
  }

  async login(dto: LoginDto) {
    // Mensagem genérica de propósito: não revelar se foi o email ou a
    // senha que estava errada (evita enumeração de contas existentes).
    const invalidCredentials = () => new UnauthorizedException('Email ou senha inválidos.');

    const userWithPassword = await this.usersService.findByEmailForLogin(dto.email);

    // Sempre chama verifyPassword, exista o usuário ou não — contra um hash
    // descartável quando não existe — para os dois caminhos custarem o
    // mesmo tempo de CPU (ver DUMMY_PASSWORD_HASH acima).
    const passwordMatches = await verifyPassword(
      dto.password,
      userWithPassword?.password ?? DUMMY_PASSWORD_HASH,
    );

    if (!userWithPassword || !userWithPassword.isActive || !passwordMatches) {
      throw invalidCredentials();
    }

    const user = await this.usersService.findAuthenticatedById(userWithPassword.id);
    if (!user) {
      throw invalidCredentials();
    }

    const tokens = await this.issueTokenPair(user.id);
    return { user: this.toPublicUser(user), ...tokens };
  }

  async refresh(rawRefreshToken: string) {
    const tokenHash = this.hashToken(rawRefreshToken);
    const invalid = () => new UnauthorizedException('Refresh token inválido ou expirado.');

    const stored = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });
    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      throw invalid();
    }

    // Rotação atômica (corrige achado crítico Qwen rodada 4, C4): a versão
    // anterior fazia um SELECT (checa revokedAt) seguido de um UPDATE
    // separado — duas requisições concorrentes com o MESMO refresh token
    // liam ambas `revokedAt = null` antes de qualquer uma escrever, e as
    // duas emitiam um par novo (a mesma classe de bug do `filledCount`,
    // lição nº 2 da avaliação anterior). Colocar `revokedAt: null` também
    // no WHERE do UPDATE faz o Postgres decidir atomicamente: só uma
    // requisição consegue revogar a linha (count = 1); a(s) outra(s)
    // encontra(m) count = 0 e trata(m) como replay.
    const { count } = await this.prisma.refreshToken.updateMany({
      where: { id: stored.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (count === 0) {
      throw invalid();
    }

    const user = await this.usersService.findAuthenticatedById(stored.userId);
    if (!user) {
      throw invalid();
    }

    const tokens = await this.issueTokenPair(user.id);
    return { user: this.toPublicUser(user), ...tokens };
  }

  async logout(userId: number, rawRefreshToken: string): Promise<void> {
    const tokenHash = this.hashToken(rawRefreshToken);
    await this.prisma.refreshToken.updateMany({
      where: { userId, tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async issueTokenPair(userId: number): Promise<TokenPair> {
    const accessToken = await this.jwtService.signAsync(
      { sub: userId },
      {
        secret: this.configService.getOrThrow<string>('JWT_SECRET'),
        expiresIn: this.configService.get<string>('JWT_EXPIRES_IN', '15m') as never,
      },
    );

    const rawRefreshToken = randomBytes(48).toString('hex');
    const refreshExpiresIn = this.configService.get<string>('JWT_REFRESH_EXPIRES_IN', '7d');

    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: this.hashToken(rawRefreshToken),
        expiresAt: new Date(Date.now() + parseDurationToMs(refreshExpiresIn)),
      },
    });

    return { accessToken, refreshToken: rawRefreshToken };
  }

  // SHA-256 determinístico (não bcrypt): precisamos localizar a linha por
  // igualdade no banco (`WHERE tokenHash = ...`), o que bcrypt não permite
  // por ser não-determinístico. Diferente de senha (baixa entropia, força
  // bruta viável), um refresh token aleatório de 48 bytes não é
  // vulnerável a força bruta mesmo com hash determinístico.
  private hashToken(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }

  private toPublicUser(user: { id: number; name: string; email: string; roleName: string }) {
    return { id: user.id, name: user.name, email: user.email, role: user.roleName };
  }
}
