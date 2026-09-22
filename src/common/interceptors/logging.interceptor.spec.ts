import { describe, expect, it, vi } from 'vitest';
import { Logger, type CallHandler, type ExecutionContext } from '@nestjs/common';
import { of, throwError, lastValueFrom } from 'rxjs';
import { LoggingInterceptor } from './logging.interceptor.js';

function buildContext(overrides?: { userId?: number; statusCode?: number }) {
  const request = { method: 'GET', originalUrl: '/jobs/1', user: overrides?.userId ? { id: overrides.userId } : undefined };
  const response = { statusCode: overrides?.statusCode ?? 200 };
  return {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ExecutionContext;
}

describe('LoggingInterceptor', () => {
  it('deixa a resposta de sucesso passar sem alterar o valor', async () => {
    const interceptor = new LoggingInterceptor();
    const context = buildContext({ statusCode: 200 });
    const handler: CallHandler = { handle: () => of({ id: 1 }) };

    const result = await lastValueFrom(interceptor.intercept(context, handler));

    expect(result).toEqual({ id: 1 });
  });

  it('loga método, rota, status e id do usuário quando autenticado', async () => {
    const logSpy = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const interceptor = new LoggingInterceptor();
    const context = buildContext({ userId: 42, statusCode: 200 });
    const handler: CallHandler = { handle: () => of('ok') };

    await lastValueFrom(interceptor.intercept(context, handler));

    expect(logSpy).toHaveBeenCalledWith(expect.stringMatching(/^GET \/jobs\/1 200 \d+ms user=42$/));
    logSpy.mockRestore();
  });

  it('propaga o erro adiante (não engole exceção) e ainda assim loga', async () => {
    const logSpy = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const interceptor = new LoggingInterceptor();
    const context = buildContext({ statusCode: 404 });
    const handler: CallHandler = { handle: () => throwError(() => new Error('não encontrado')) };

    await expect(lastValueFrom(interceptor.intercept(context, handler))).rejects.toThrow('não encontrado');
    expect(logSpy).toHaveBeenCalledWith(expect.stringMatching(/^GET \/jobs\/1 404 \d+ms$/));
    logSpy.mockRestore();
  });
});
