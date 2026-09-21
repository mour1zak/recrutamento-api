const UNIT_TO_MS: Record<string, number> = {
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
};

/**
 * Converte strings simples tipo "15m", "7d" em milissegundos. Só o
 * suficiente para JWT_EXPIRES_IN/JWT_REFRESH_EXPIRES_IN — não é um
 * parser de propósito geral.
 */
export function parseDurationToMs(value: string): number {
  const match = /^(\d+)(s|m|h|d)$/.exec(value.trim());
  if (!match) {
    throw new Error(`Formato de duração inválido: "${value}" (use algo como "15m" ou "7d")`);
  }
  const [, amount, unit] = match;
  return Number(amount) * UNIT_TO_MS[unit];
}
