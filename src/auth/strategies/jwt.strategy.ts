import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { UsersService } from '../../users/users.service.js';
import type { AuthenticatedUser } from '../../common/types/authenticated-user.js';

interface JwtPayload {
  sub: number;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    private readonly usersService: UsersService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.getOrThrow<string>('JWT_SECRET'),
    });
  }

  // Revalida no banco a cada request (padrão validado na auditoria do
  // DEVCONNECT) em vez de confiar em papel/permissões embutidos no token:
  // uma mudança de permissão em runtime (Nível B) ou uma desativação de
  // usuário têm efeito imediato, sem esperar o token expirar.
  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    const user = await this.usersService.findAuthenticatedById(payload.sub);
    if (!user) {
      throw new UnauthorizedException('Sessão inválida ou usuário desativado.');
    }
    return user;
  }
}
