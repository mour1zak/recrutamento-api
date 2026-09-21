import { IsString, IsNotEmpty, MaxLength } from 'class-validator';

export class RefreshTokenDto {
  // 96 (hex de 48 bytes) é o tamanho real gerado; 256 dá folga sem permitir
  // payload arbitrariamente grande sendo hasheado e consultado no banco
  // (achado Qwen rodada 4, P1).
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  refreshToken!: string;
}
