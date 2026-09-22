/**
 * Corpo estruturado de erro com um `reason` machine-readable, além da
 * `message` legível por humano — decisão tomada a partir do módulo
 * Companies em diante (sugestão Qwen/DeepSeek, Fase 2). O Auth (já
 * auditado) continua com o formato antigo ({statusCode, error, message}),
 * não foi retroalimentado para não reabrir escopo já fechado.
 *
 * `statusCode` precisa vir explícito aqui: `HttpException` só preenche
 * esse campo automaticamente quando o argumento é uma `string` — passar
 * um objeto literal (nosso caso, para incluir `reason`) substitui o corpo
 * inteiro, sem merge implícito.
 */
export function errorBody(status: number, reason: string, message: string) {
  return { statusCode: status, reason, message };
}
