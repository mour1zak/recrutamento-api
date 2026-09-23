import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { AppService } from './app.service.js';
import { Public } from './common/decorators/public.decorator.js';

@ApiTags('Saúde')
@ApiSecurity('api-key')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @ApiOperation({ summary: 'Verificar se a API está de pé', description: 'Não exige JWT — só a API key (decisão CE-1: nenhuma rota é isenta da API key).' })
  @ApiResponse({ status: 200, description: 'API operacional.' })
  @ApiResponse({ status: 401, description: 'API key ausente/inválida.' })
  // Health check: isento de JWT (não faz sentido autenticar como usuário
  // pra verificar se a API está de pé), mas ainda exige API key (decisão
  // CE-1 — sem rotas isentas dela). Substitui o placeholder "Hello World"
  // do scaffold (achado Qwen rodada 4, R15).
  @Public()
  @Get('health')
  getHealth() {
    return this.appService.getHealth();
  }
}
