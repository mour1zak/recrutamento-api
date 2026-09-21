import { Catch, HttpStatus, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';
import { Prisma } from '../../generated/prisma/client.js';

const STATUS_TEXT: Record<number, string> = {
  [HttpStatus.BAD_REQUEST]: 'Bad Request',
  [HttpStatus.NOT_FOUND]: 'Not Found',
  [HttpStatus.CONFLICT]: 'Conflict',
};

/**
 * Corrige achado Qwen rodada 4 (R1): sem filtro global, um erro do Prisma
 * (unique violado, FK apontando pra registro inexistente, conflito de
 * transação) virava `500` cru — exatamente a lição nº 5 da avaliação
 * anterior ("erro de negócio virando 500 em vez de 400/404/409").
 * Alcançável hoje mesmo sem concorrência real: dois `POST /auth/register`
 * com o mesmo email em paralelo, ou `roleId` inexistente se o seed não
 * rodou.
 */
@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaExceptionFilter implements ExceptionFilter {
  catch(exception: Prisma.PrismaClientKnownRequestError, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    const { status, message } = this.mapError(exception);

    response.status(status).json({
      statusCode: status,
      error: STATUS_TEXT[status] ?? 'Error',
      message,
    });
  }

  private mapError(exception: Prisma.PrismaClientKnownRequestError): { status: number; message: string } {
    switch (exception.code) {
      case 'P2002': {
        const target = Array.isArray(exception.meta?.target) ? exception.meta.target.join(', ') : 'valor único';
        return {
          status: HttpStatus.CONFLICT,
          message: `Já existe um registro com o mesmo valor em: ${target}.`,
        };
      }
      case 'P2025':
        return { status: HttpStatus.NOT_FOUND, message: 'Recurso não encontrado.' };
      case 'P2003':
        return { status: HttpStatus.BAD_REQUEST, message: 'Referência a um recurso relacionado inexistente.' };
      case 'P2034':
      case 'P2028':
        return { status: HttpStatus.CONFLICT, message: 'Conflito de concorrência — tente novamente.' };
      default:
        return { status: HttpStatus.CONFLICT, message: 'Conflito ao processar a operação.' };
    }
  }
}
