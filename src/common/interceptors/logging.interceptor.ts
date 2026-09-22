import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import type { Request, Response } from 'express';
import { tap } from 'rxjs';
import type { AuthenticatedUser } from '../types/authenticated-user.js';

/**
 * Item obrigatório do enunciado ("ao menos um interceptor útil").
 * Registrado global (`APP_INTERCEPTOR`) — loga toda requisição depois de
 * resolvida, nunca antes (só reagimos ao resultado real, sem duplicar log
 * em caso de erro: o `GlobalExceptionFilter` já teria respondido, e o
 * `finalize`/`tap` de erro abaixo cobre esse caminho também).
 *
 * Deliberadamente NÃO loga body/query/headers — só metadados (rota,
 * status, duração, id do usuário autenticado quando existir). Logar corpo
 * de requisição arriscaria vazar senha/token pro log (mesma lição do
 * `omit` global do Prisma e do `SEED_USER_PASSWORD` nunca impresso no
 * seed) — é o tipo de decisão que só custa caro se for revertida depois.
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler) {
    const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const response = context.switchToHttp().getResponse<Response>();
    const { method, originalUrl } = request;
    const start = Date.now();

    return next.handle().pipe(
      tap({
        next: () => this.log(method, originalUrl, response.statusCode, start, request.user?.id),
        error: (error: unknown) => {
          // Erro já tratado pelo GlobalExceptionFilter a essa altura —
          // `response.statusCode` já reflete o status final que o filtro
          // escreveu, mesmo num caminho de exceção.
          const status = (error as { status?: number })?.status ?? response.statusCode;
          this.log(method, originalUrl, status, start, request.user?.id);
        },
      }),
    );
  }

  private log(method: string, url: string, status: number, start: number, userId?: number): void {
    const durationMs = Date.now() - start;
    const who = userId ? ` user=${userId}` : '';
    this.logger.log(`${method} ${url} ${status} ${durationMs}ms${who}`);
  }
}
