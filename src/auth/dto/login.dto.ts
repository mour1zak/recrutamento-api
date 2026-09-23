import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({ description: 'Email cadastrado (comparado já normalizado).', example: 'admin@recrutamento.test' })
  @IsEmail()
  @MaxLength(180)
  email!: string;

  @ApiProperty({ description: 'Senha da conta.', example: 'Senha@123' })
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  password!: string;
}
