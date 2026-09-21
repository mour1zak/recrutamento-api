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
    if (!userWithPassword || !userWithPassword.isActive) {
      throw invalidCredentials();
    }

    const passwordMatches = await verifyPassword(dto.password, userWithPassword.password);
    if (!passwordMatches) {
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

    const stored = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });
    const invalid = () => new UnauthorizedException('Refresh token inválido ou expirado.');

    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      throw invalid();
    }

    const user = await this.usersService.findAuthenticatedById(stored.userId);
    if (!user) {
      throw invalid();
    }

    // Rotação: o refresh token usado é revogado e um par novo é emitido —
    // limita o dano de um refresh token roubado a um único uso.
    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });

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
