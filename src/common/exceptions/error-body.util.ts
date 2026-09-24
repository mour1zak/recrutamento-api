import { HttpStatus } from '@nestjs/common';

// Compartilhado com `global-exception.filter.ts` — um só lugar traduzindo
// status HTTP pro texto padrão, pra não ter dois dicionários divergindo.
export const STATUS_TEXT: Record<number, string> = {
  [HttpStatus.BAD_REQUEST]: 'Bad Request',
  [HttpStatus.UNAUTHORIZED]: 'Unauthorized',
  [HttpStatus.FORBIDDEN]: 'Forbidden',
  [HttpStatus.NOT_FOUND]: 'Not Found',
  [HttpStatus.CONFLICT]: 'Conflict',
  [HttpStatus.BAD_GATEWAY]: 'Bad Gateway',
  [HttpStatus.SERVICE_UNAVAILABLE]: 'Service Unavailable',
  [HttpStatus.INTERNAL_SERVER_ERROR]: 'Internal Server Error',
};

/**
 * Corpo estruturado de erro com um `reason` machine-readable, além da
 * `message` legível por humano — decisão tomada a partir do módulo
 * Companies em diante (sugestãa revisão técnica/especificação de negócio, Fase 2). O Auth (já
 * auditado) continua com o formato antigo ({statusCode, error, message}
 * sem `reason`), não foi retroalimentado para não reabrir escopo já
 * fechado.
 *
 * `statusCode` precisa vir explícito aqui: `HttpException` só preenche
 * esse campo automaticamente quando o argumento é uma `string` — passar
 * um objeto literal (nosso caso, para incluir `reason`) substitui o corpo
 * inteiro, sem merge implícito.
 *
 * Achado da revisão técnica (ressalva 6, contrato de erro): antes, este corpo
 * não tinha o campo `error` que o `GlobalExceptionFilter.respond()` (usado
 * pelos erros mapeados do Prisma) sempre inclui — dois formatos de `409`
 * conviviam no mesmo módulo, um com `error` e outro sem. Incluído aqui
 * também, usando o mesmo dicionário, pra normalizar os dois caminhos.
 */
export function errorBody(status: number, reason: string, message: string) {
  return { statusCode: status, error: STATUS_TEXT[status] ?? 'Error', reason, message };
}
