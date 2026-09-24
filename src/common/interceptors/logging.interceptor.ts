import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import type { Request, Response } from 'express';
import { tap } from 'rxjs';
import type { AuthenticatedUser } from '../types/authenticated-user.js';

// Marca no próprio objeto de requisição que este interceptor já escreveu
// a linha de log — o `GlobalExceptionFilter` lê essa marca antes de logar
// de novo. Acoplamento mínimo (um campo, não um serviço) entre as duas
// únicas classes deste projeto que logam requisição HTTP.
export const HTTP_LOG_WRITTEN = Symbol('httpLogWritten');
type RequestWithHttpLogMarker = Request & { user?: AuthenticatedUser; [HTTP_LOG_WRITTEN]?: boolean };

/**
 * Item obrigatório do enunciado ("ao menos um interceptor útil").
 * Registrado global (`APP_INTERCEPTOR`) — loga a requisição depois de
 * resolvida pelo HANDLER (rota que casou e passou pelos guards), nunca
 * antes.
 *
 * Achado (R1): interceptors rodam DEPOIS dos guards no pipeline do
 * Nest — uma rejeição de `ApiKeyGuard`/`JwtAuthGuard`/`PermissionsGuard`
 * (401/403), ou uma rota inexistente (404 do router), nunca chegam aqui.
 * Esses casos são logados pelo `GlobalExceptionFilter`
 * (`src/common/filters/global-exception.filter.ts`), que é o único ponto
 * que enxerga essas exceções antes de qualquer interceptor — os dois
 * juntos cobrem o que "toda requisição" promete, sem duplicar: este
 * interceptor marca `HTTP_LOG_WRITTEN` na requisição depois de logar, e o
 * filtro pula a própria linha se essa marca já estiver presente (achado
 * da auditoria final: um erro de negócio lançado por um Service — que
 * PASSA por este interceptor — gerava duas linhas pra mesma requisição,
 * uma em `LOG` aqui e outra em `WARN` no filtro, com a mesma informação).
 *
 * Log estruturado (JSON, um objeto por linha) em vez de string livre —
 * mais fácil de indexar/filtrar no Grafana/Loki (já configurado neste
 * projeto) do que fazer regex em cima de texto solto.
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
    const request = context.switchToHttp().getRequest<RequestWithHttpLogMarker>();
    const response = context.switchToHttp().getResponse<Response>();
    const { method, originalUrl } = request;
    const start = Date.now();

    return next.handle().pipe(
      tap({
        next: () => this.log(request, method, originalUrl, response.statusCode, start, request.user?.id),
        error: (error: unknown) => {
          // Erro já tratado pelo GlobalExceptionFilter a essa altura —
          // `response.statusCode` já reflete o status final que o filtro
          // escreveu, mesmo num caminho de exceção.
          const status = (error as { status?: number })?.status ?? response.statusCode;
          this.log(request, method, originalUrl, status, start, request.user?.id);
        },
      }),
    );
  }

  private log(request: RequestWithHttpLogMarker, method: string, route: string, status: number, start: number, userId?: number): void {
    const durationMs = Date.now() - start;
    this.logger.log(JSON.stringify({ event: 'http_request', method, route, status, durationMs, ...(userId ? { userId } : {}) }));
    request[HTTP_LOG_WRITTEN] = true;
  }
}
