import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApplicationStatus } from '../../generated/prisma/client.js';

export class UpdateApplicationStatusDto {
  @ApiProperty({ description: 'Novo status da candidatura. `HIRED` dispara a checagem atômica de capacidade da vaga (`filledCount` vs. `vacancies`).', enum: ApplicationStatus })
  @IsEnum(ApplicationStatus)
  status!: ApplicationStatus;

  @ApiPropertyOptional({ description: 'Motivo da mudança de status (ex.: justificativa de rejeição).', maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
