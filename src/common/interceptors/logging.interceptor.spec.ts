import { describe, expect, it, vi } from 'vitest';
import { Logger, type CallHandler, type ExecutionContext } from '@nestjs/common';
import { of, throwError, lastValueFrom } from 'rxjs';
import { HTTP_REQUEST_START, LoggingInterceptor } from './logging.interceptor.js';

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

  it('loga método, rota, status e id do usuário quando autenticado (JSON estruturado), e marca o início da requisição', async () => {
    const logSpy = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const interceptor = new LoggingInterceptor();
    const { context, request } = buildContext({ userId: 42, statusCode: 200 });
    const handler: CallHandler = { handle: () => of('ok') };

    await lastValueFrom(interceptor.intercept(context, handler));

    expect(logSpy).toHaveBeenCalledTimes(1);
    const logged = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(logged).toMatchObject({ event: 'http_request', method: 'GET', route: '/jobs/1', status: 200, userId: 42 });
    expect(typeof logged.durationMs).toBe('number');
    // Achado crítico da revisão final: o `GlobalExceptionFilter` usa a
    // PRESENÇA desta marca (não um valor booleano — o timestamp real) pra
    // saber se uma requisição que terminou em erro passou pelos guards
    // (LOG, com duração) ou foi rejeitada antes de chegar aqui (WARN, sem
    // duração).
    expect(typeof request[HTTP_REQUEST_START]).toBe('number');
    logSpy.mockRestore();
  });

  it('em erro, NÃO loga (a auditoria final achou o interceptor logando o status ERRADO de erros traduzidos pelo filtro) — mas marca o início mesmo assim', async () => {
    const logSpy = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const interceptor = new LoggingInterceptor();
    const { context, request } = buildContext({ statusCode: 201 }); // status "padrão" que o Nest atribuiria a um POST antes do erro
    const handler: CallHandler = { handle: () => throwError(() => new Error('conflito de negócio, ex.: CNPJ duplicado')) };

    await expect(lastValueFrom(interceptor.intercept(context, handler))).rejects.toThrow();

    // O ponto do achado: o interceptor NUNCA deveria ter logado "201" (ou
    // qualquer status) pra este erro — só o GlobalExceptionFilter, depois
    // de traduzir a exceção, sabe o status final de verdade.
    expect(logSpy).not.toHaveBeenCalled();
    expect(typeof request[HTTP_REQUEST_START]).toBe('number');
    logSpy.mockRestore();
  });
});
