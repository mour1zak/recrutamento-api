import { createHash, timingSafeEqual } from 'node:crypto';

// Extraído de `ApiKeyGuard` (achado Qwen rodada 15): a checagem de API
// key passou a ter um segundo consumidor (`docs-auth.middleware.ts`, fora
// do pipeline de guards do Nest) — duplicar um algoritmo de comparação
// sensível a timing em dois lugares é o mesmo risco de divergência
// silenciosa que motivou extrair `isCompanyOperable()`.
export function timingSafeApiKeyMatch(provided: string, expected: string): boolean {
  const providedHash = createHash('sha256').update(provided).digest();
  const expectedHash = createHash('sha256').update(expected).digest();
  return timingSafeEqual(providedHash, expectedHash);
}
