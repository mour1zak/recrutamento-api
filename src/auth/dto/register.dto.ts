import { IsEmail, IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

export class RegisterDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @IsEmail()
  @MaxLength(180)
  email!: string;

  // 256 é só um teto de sanidade (evitar payload absurdo), não ligado ao
  // limite do bcrypt: a senha é pré-hasheada com SHA-256 antes do bcrypt
  // (src/common/utils/password.util.ts), então não existe mais truncamento
  // silencioso — não precisamos "acertar o número mágico" do bcrypt aqui.
  @IsString()
  @MinLength(8)
  @MaxLength(256)
  password!: string;
}
