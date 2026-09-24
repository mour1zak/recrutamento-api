import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, MaxLength } from 'class-validator';

export class RefreshTokenDto {
  // 96 (hex de 48 bytes) é o tamanho real gerado; 256 dá folga sem permitir
  // payload arbitrariamente grande sendo hasheado e consultado no banco
  // (achado da revisão técnica, P1).
  @ApiProperty({ description: 'Refresh token opaco recebido em `/auth/login` ou `/auth/register`. Rotaciona a cada uso — o antigo é invalidado.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  refreshToken!: string;
}
