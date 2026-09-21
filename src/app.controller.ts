import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service.js';
import { Public } from './common/decorators/public.decorator.js';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

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
