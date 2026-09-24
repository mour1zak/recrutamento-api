import { describe, expect, it, vi } from 'vitest';
import { ArgumentsHost, Logger, PayloadTooLargeException } from '@nestjs/common';
import { GlobalExceptionFilter } from './global-exception.filter.js';
import { HTTP_REQUEST_START } from '../interceptors/logging.interceptor.js';

// Achado crítico da revisão final: antes desta correção, o
// `LoggingInterceptor` logava erros com o status ERRADO (o padrão que o
// Nest atribui à rota ANTES de qualquer coisa rodar — ex.: `201` pra
// POST — não o status que este filtro de fato envia depois de traduzir a
// exceção). Este teste trava exatamente esse comportamento: o status
// logado precisa ser o que o CLIENTE recebe, não o que a rota tinha
// "por padrão".
function buildHost(overrides?: { hasRequestStart?: boolean }) {
  const request: Record<string | symbol, unknown> = { method: 'POST', originalUrl: '/documents' };
  if (overrides?.hasRequestStart) {
    request[HTTP_REQUEST_START] = Date.now() - 5;
  }
  const response = { setHeader: vi.fn(), status: vi.fn().mockReturnThis(), json: vi.fn() };
  const host = {
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }),
  } as unknown as ArgumentsHost;
  return { host, response };
}

describe('GlobalExceptionFilter', () => {
  it('loga o status FINAL (traduzido), não o status padrão da rota', () => {
    const logSpy = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const filter = new GlobalExceptionFilter();
    const { host, response } = buildHost({ hasRequestStart: true });

    filter.catch(new PayloadTooLargeException(), host);

    // O achado real: o multer devolve 413 nativamente, mas o contrato
    // deste projeto exige 400 (`arquivo_excede_tamanho_maximo`) — o log
    // precisa refletir os 400 que o cliente de fato recebe.
    expect(response.status).toHaveBeenCalledWith(400);
    const logged = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(logged).toMatchObject({ event: 'http_request', method: 'POST', route: '/documents', status: 400 });
    logSpy.mockRestore();
  });

  it('LOG (não WARN) quando a requisição passou pelos guards (HTTP_REQUEST_START presente), com durationMs', () => {
    const logSpy = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const filter = new GlobalExceptionFilter();
    const { host } = buildHost({ hasRequestStart: true });

    filter.catch(new PayloadTooLargeException(), host);

    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).not.toHaveBeenCalled();
    const logged = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(typeof logged.durationMs).toBe('number');
    logSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('WARN (não LOG) quando a requisição NUNCA passou pelos guards (rejeição de guard/rota — sem HTTP_REQUEST_START), sem durationMs', () => {
    const logSpy = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const filter = new GlobalExceptionFilter();
    const { host } = buildHost({ hasRequestStart: false });

    filter.catch(new PayloadTooLargeException(), host);

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).not.toHaveBeenCalled();
    const logged = JSON.parse(warnSpy.mock.calls[0][0] as string);
    expect(logged.durationMs).toBeUndefined();
    logSpy.mockRestore();
    warnSpy.mockRestore();
  });
});
