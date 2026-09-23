import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class UpdateJobDto {
  @ApiPropertyOptional({ description: 'Novo título.', maxLength: 160 })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  title?: string;

  @ApiPropertyOptional({ description: 'Nova descrição.', maxLength: 4000 })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  description?: string;

  @ApiPropertyOptional({ description: 'Novo número de posições. Não pode ficar abaixo do que já foi preenchido (`filledCount`).', minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  vacancies?: number;

  @ApiPropertyOptional({ description: 'Novo salário mínimo.', minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  salaryMin?: number;

  @ApiPropertyOptional({ description: 'Novo salário máximo.', minimum: 0, maximum: 100_000_000 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100_000_000)
  salaryMax?: number;

  @ApiPropertyOptional({ description: 'Se a vaga é remota.' })
  @IsOptional()
  @IsBoolean()
  isRemote?: boolean;
}
