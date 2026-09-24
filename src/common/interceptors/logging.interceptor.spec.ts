import { describe, expect, it, vi } from 'vitest';
import { Logger, type CallHandler, type ExecutionContext } from '@nestjs/common';
import { of, throwError, lastValueFrom } from 'rxjs';
import { HTTP_LOG_WRITTEN, LoggingInterceptor } from './logging.interceptor.js';

function buildContext(overrides?: { userId?: number; statusCode?: number }) {
  const request: Record<string | symbol, unknown> = { method: 'GET', originalUrl: '/jobs/1', user: overrides?.userId ? { id: overrides.userId } : undefined };
  const response = { statusCode: overrides?.statusCode ?? 200 };
  return {
    request,
    context: {
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => response,
      }),
    } as unknown as ExecutionContext,
  };
}

describe('LoggingInterceptor', () => {
  it('deixa a resposta de sucesso passar sem alterar o valor', async () => {
    const interceptor = new LoggingInterceptor();
    const { context } = buildContext({ statusCode: 200 });
    const handler: CallHandler = { handle: () => of({ id: 1 }) };

    const result = await lastValueFrom(interceptor.intercept(context, handler));

    expect(result).toEqual({ id: 1 });
  });

  it('loga método, rota, status e id do usuário quando autenticado (JSON estruturado), e marca a requisição', async () => {
    const logSpy = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const interceptor = new LoggingInterceptor();
    const { context, request } = buildContext({ userId: 42, statusCode: 200 });
    const handler: CallHandler = { handle: () => of('ok') };

    await lastValueFrom(interceptor.intercept(context, handler));

    expect(logSpy).toHaveBeenCalledTimes(1);
    const logged = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(logged).toMatchObject({ event: 'http_request', method: 'GET', route: '/jobs/1', status: 200, userId: 42 });
    expect(typeof logged.durationMs).toBe('number');
    // Achado da auditoria final: o filtro global pula a própria linha
    // quando encontra esta marca, pra não duplicar o log de erros de
    // negócio que passam pelo interceptor.
    expect(request[HTTP_LOG_WRITTEN]).toBe(true);
    logSpy.mockRestore();
  });

  it('propaga o erro adiante (não engole exceção) e ainda assim loga, sem `userId` quando anônimo', async () => {
    const logSpy = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const interceptor = new LoggingInterceptor();
    const { context } = buildContext({ statusCode: 404 });
    const handler: CallHandler = { handle: () => throwError(() => new Error('não encontrado')) };

    await expect(lastValueFrom(interceptor.intercept(context, handler))).rejects.toThrow('não encontrado');
    const logged = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(logged).toMatchObject({ event: 'http_request', method: 'GET', route: '/jobs/1', status: 404 });
    expect(logged.userId).toBeUndefined();
    logSpy.mockRestore();
  });
});
