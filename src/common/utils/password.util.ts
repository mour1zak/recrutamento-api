import { createHash } from 'node:crypto';
import * as bcrypt from 'bcryptjs';

const BCRYPT_ROUNDS = 10;

/**
 * bcrypt trunca silenciosamente a entrada em 72 BYTES (não caracteres) —
 * uma senha longa com acentuação (comum em português: "ç", "ã", "é" usam
 * 2 bytes em UTF-8) pode ultrapassar isso mesmo com poucos caracteres,
 * fazendo caracteres do fim da senha nunca serem considerados na
 * comparação. Em vez de limitar o tamanho aceito no DTO (número arbitrário
 * do ponto de vista de quem usa a API, achado real ao revisar
 * `@MaxLength(72)` nos DTOs), pré-hasheamos com SHA-256: a saída tem
 * sempre 32 bytes, então o bcrypt nunca mais vê uma entrada "grande
 * demais", para qualquer idioma ou tamanho de senha.
 */
function preHash(plainPassword: string): string {
  return createHash('sha256').update(plainPassword, 'utf8').digest('hex');
}

export function hashPassword(plainPassword: string): Promise<string> {
  return bcrypt.hash(preHash(plainPassword), BCRYPT_ROUNDS);
}

export function verifyPassword(plainPassword: string, storedHash: string): Promise<boolean> {
  return bcrypt.compare(preHash(plainPassword), storedHash);
}
