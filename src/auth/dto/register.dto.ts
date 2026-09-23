import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

export class RegisterDto {
  @ApiProperty({ description: 'Nome completo do candidato.', example: 'Maria Silva', maxLength: 120 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @ApiProperty({ description: 'Email — normalizado (minúsculas + trim) antes de checar unicidade e no login.', example: 'maria.silva@example.com', maxLength: 180 })
  @IsEmail()
  @MaxLength(180)
  email!: string;

  // 256 é só um teto de sanidade (evitar payload absurdo), não ligado ao
  // limite do bcrypt: a senha é pré-hasheada com SHA-256 antes do bcrypt
  // (src/common/utils/password.util.ts), então não existe mais truncamento
  // silencioso — não precisamos "acertar o número mágico" do bcrypt aqui.
  @ApiProperty({ description: 'Senha — mínimo 8 caracteres. Sempre cria a conta como papel CANDIDATE.', example: 'SenhaForte@123', minLength: 8, maxLength: 256 })
  @IsString()
  @MinLength(8)
  @MaxLength(256)
  password!: string;
}
