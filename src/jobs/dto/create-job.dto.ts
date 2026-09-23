import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class CreateJobDto {
  @ApiProperty({ description: 'Título da vaga.', example: 'Desenvolvedor(a) Backend Node.js', maxLength: 160 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  title!: string;

  @ApiProperty({ description: 'Descrição completa da vaga.', maxLength: 4000 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  description!: string;

  @ApiProperty({ description: 'Número de posições disponíveis.', minimum: 1, example: 2 })
  @IsInt()
  @Min(1)
  vacancies!: number;

  @ApiPropertyOptional({ description: 'Salário mínimo (em reais, valor inteiro).', minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  salaryMin?: number;

  @ApiPropertyOptional({ description: 'Salário máximo (em reais, valor inteiro).', minimum: 0, maximum: 100_000_000 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100_000_000)
  salaryMax?: number;

  @ApiProperty({ description: 'Se a vaga é remota.' })
  @IsBoolean()
  isRemote!: boolean;

  // Só ADMIN usa este campo (obrigatório pra eles, já que não têm
  // companyId próprio) — RECRUITER tem a vaga atrelada à própria empresa
  // automaticamente; se um RECRUITER mandar um valor diferente do seu,
  // vira 404 (CompaniesService/JobsService.assertScopeOrThrow), não 400,
  // pra não confirmar/negar a existência da empresa de terceiro.
  @ApiPropertyOptional({ description: 'ID da empresa dona da vaga — obrigatório para ADMIN (que não tem empresa própria); ignorado/validado contra a própria empresa para RECRUITER.' })
  @IsOptional()
  @IsInt()
  companyId?: number;
}
