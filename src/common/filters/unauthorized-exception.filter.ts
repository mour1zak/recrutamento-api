import { Catch, UnauthorizedException, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';

/**
 * Corrige achado Qwen rodada 5 (N14, pendente desde a rodada 3): RFC 9110
 * §15.5.2 exige o header `WWW-Authenticate` em toda resposta `401`. Sem
 * isso, alguns clientes/validadores de contrato tratam a resposta como
 * inconsistente mesmo com o código HTTP correto.
 */
@Catch(UnauthorizedException)
export class UnauthorizedExceptionFilter implements ExceptionFilter {
  catch(exception: UnauthorizedException, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    response.setHeader('WWW-Authenticate', 'Bearer');
    response.status(exception.getStatus()).json(exception.getResponse());
  }
}
