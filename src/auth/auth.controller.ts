import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service.js';
import { RegisterDto } from './dto/register.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { RefreshTokenDto } from './dto/refresh-token.dto.js';
import { Public } from '../common/decorators/public.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../common/types/authenticated-user.js';

// register/login/refresh usam @Public() — isentam do JwtAuthGuard global
// (não faz sentido exigir "estar logado" para logar). O ApiKeyGuard
// (APP_GUARD global) continua se aplicando a todos, inclusive estes
// (decisão CE-1). `logout` não tem @Public(): precisa de JWT válido, e
// isso já é garantido pelo JwtAuthGuard global — não precisa mais de
// @UseGuards() explícito aqui (achado da revisão técnica, C2).
//
// Nota sobre o formato de erro: as rotas deste controller usam o formato
// ANTIGO ({statusCode, error, message}, sem `reason`) — já auditado e
// fechado desde a Fase 2, deliberadamente não retroalimentado com o
// formato estruturado dos módulos de domínio (ver README §5).
@ApiTags('Autenticação')
@ApiSecurity('api-key')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @ApiOperation({ summary: 'Registrar candidato', description: 'Cria uma conta nova, sempre com papel CANDIDATE. Já devolve o par de tokens (login automático).' })
  @ApiResponse({ status: 201, description: 'Conta criada — devolve `user` + `accessToken` + `refreshToken`.' })
  @ApiResponse({ status: 400, description: 'DTO inválido (nome/email/senha fora do formato).' })
  @ApiResponse({ status: 401, description: 'API key ausente ou inválida.' })
  @ApiResponse({ status: 409, description: 'Email já cadastrado.' })
  @Public()
  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @ApiOperation({ summary: 'Login', description: 'Autentica com email + senha. Devolve um novo par de tokens a cada chamada.' })
  @ApiResponse({ status: 200, description: 'Autenticado — devolve `user` + `accessToken` + `refreshToken`.' })
  @ApiResponse({ status: 400, description: 'DTO inválido.' })
  @ApiResponse({ status: 401, description: 'API key ausente/inválida, ou credenciais inválidas.' })
  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @ApiOperation({ summary: 'Renovar sessão', description: 'Troca um refresh token válido por um par novo (rotação — o token usado é invalidado, mesmo que a chamada falhe depois).' })
  @ApiResponse({ status: 200, description: 'Novo par de tokens.' })
  @ApiResponse({ status: 400, description: 'DTO inválido.' })
  @ApiResponse({ status: 401, description: 'API key ausente/inválida, ou refresh token inválido/expirado/já usado/revogado.' })
  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('refresh')
  refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refresh(dto.refreshToken);
  }

  @ApiOperation({ summary: 'Logout', description: 'Revoga o refresh token informado — a sessão associada não pode mais ser renovada.' })
  @ApiBody({ type: RefreshTokenDto })
  @ApiResponse({ status: 204, description: 'Sessão encerrada.' })
  @ApiResponse({ status: 400, description: 'DTO inválido.' })
  @ApiResponse({ status: 401, description: 'API key ausente/inválida, ou JWT ausente/inválido/expirado.' })
  @ApiBearerAuth('jwt')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Post('logout')
  logout(@CurrentUser() user: AuthenticatedUser, @Body() dto: RefreshTokenDto) {
    return this.authService.logout(user.id, dto.refreshToken);
  }
}
