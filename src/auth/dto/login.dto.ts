import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  // Achado CRÍTICO Qwen rodada 15: o `example` anterior usava o email
  // REAL do ADMIN do seed (`admin@recrutamento.test`) — combinado com a
  // senha real (ver `password` abaixo), o Swagger publicava as duas
  // metades de uma credencial viva. Nunca usar aqui um valor que exista
  // de verdade em algum ambiente semeado.
  @ApiProperty({ description: 'Email cadastrado (comparado já normalizado).', example: 'usuario@example.com' })
  @IsEmail()
  @MaxLength(180)
  email!: string;

  // Achado CRÍTICO Qwen rodada 15: `example` anterior era o valor real de
  // `SEED_USER_PASSWORD` (fallback em `prisma/seed.ts`) — a mesma lição
  // do `JWT_SECRET` nunca logado se aplica a qualquer artefato publicado
  // pela aplicação, não só a logs.
  @ApiProperty({ description: 'Senha da conta.', example: 'SenhaForte@123' })
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  password!: string;
}
