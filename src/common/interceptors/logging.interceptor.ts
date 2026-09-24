import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import type { Request, Response } from 'express';
import { tap } from 'rxjs';
import type { AuthenticatedUser } from '../types/authenticated-user.js';

// Marca em que momento a requisição começou a ser processada por este
// interceptor — ou seja, que ela PASSOU pelos guards. É o sinal que o
// `GlobalExceptionFilter` usa pra decidir, sozinho, se uma exceção é erro
// de negócio (LOG) ou rejeição de guard/rota inexistente (WARN), e pra
// calcular a duração de uma requisição que terminou em erro. Como um
// guard rejeitando a requisição nunca deixa ela chegar até aqui, a mera
// PRESENÇA desta marca já diferencia os dois casos sem precisar de nada
// mais explícito.
export const HTTP_REQUEST_START = Symbol('httpRequestStart');
type RequestWithHttpMarker = Request & { user?: AuthenticatedUser; [HTTP_REQUEST_START]?: number };

/**
 * Item obrigatório do enunciado ("ao menos um interceptor útil").
 * Registrado global (`APP_INTERCEPTOR`) — loga a requisição depois de
 * resolvida pelo HANDLER (rota que casou e passou pelos guards), nunca
 * antes.
 *
 * Achado (R1): interceptors rodam DEPOIS dos guards no pipeline do
 * Nest — uma rejeição deles (401/403), ou uma rota inexistente (404 do
 * router), nunca chegam aqui. Esses casos são logados pelo
 * `GlobalExceptionFilter` (`src/common/filters/global-exception.filter.ts`).
 *
 * **Este interceptor só loga o caminho de SUCESSO.** Achado crítico da
 * revisão final (confirmado ao vivo: um `409 cnpj_duplicado` de verdade
 * aparecia no log como `"status":201`; um `400` de upload grande demais
 * aparecia como `"status":413`): no caminho de ERRO, `response.statusCode`
 * neste ponto do pipeline ainda é o status PADRÃO que o Nest atribuiu à
 * rota antes de qualquer coisa rodar (`201` pra POST, por exemplo) — não
 * o status que o `GlobalExceptionFilter` vai de fato escrever depois de
 * traduzir a exceção (erro do Prisma, conflito de transação,
 * `PayloadTooLargeException` viram códigos diferentes do que a exceção
 * original carrega). Só o filtro sabe o status FINAL de um erro. Por
 * isso a responsabilidade de logar QUALQUER erro — de negócio ou de
 * guard — foi movida inteira pra lá; este interceptor só marca
 * `HTTP_REQUEST_START`, pro filtro saber a duração e o nível certo.
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
    const request = context.switchToHttp().getRequest<RequestWithHttpMarker>();
    const response = context.switchToHttp().getResponse<Response>();
    const { method, originalUrl } = request;
    const start = Date.now();
    request[HTTP_REQUEST_START] = start;

    return next.handle().pipe(
      tap({
        next: () => this.log(method, originalUrl, response.statusCode, start, request.user?.id),
        // Erro: deliberadamente NÃO loga aqui — ver docstring da classe.
      }),
    );
  }

  private log(method: string, route: string, status: number, start: number, userId?: number): void {
    const durationMs = Date.now() - start;
    this.logger.log(JSON.stringify({ event: 'http_request', method, route, status, durationMs, ...(userId ? { userId } : {}) }));
  }
}
