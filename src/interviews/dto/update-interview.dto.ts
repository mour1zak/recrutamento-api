import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { InterviewStatus } from '../../generated/prisma/client.js';

export class UpdateInterviewDto {
  @ApiPropertyOptional({ description: 'Novo status. `RESCHEDULED` cria uma NOVA entrevista (a rota responde `201` com o novo registro em vez de `200`).', enum: InterviewStatus })
  @IsOptional()
  @IsEnum(InterviewStatus)
  status?: InterviewStatus;

  @ApiPropertyOptional({ description: 'Feedback da entrevista.', maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  feedback?: string;

  // Só usado quando `status: "RESCHEDULED"` (vira o `scheduledAt` da NOVA
  // entrevista criada) — contrato definido na especificação de negócio (Fase 2,
  // mapa de endpoints §5).
  @ApiPropertyOptional({ description: 'Nova data/hora — obrigatório junto de `status: "RESCHEDULED"`; vira o `scheduledAt` da nova entrevista criada.', example: '2026-10-05T14:00:00.000Z' })
  @IsOptional()
  @IsDateString()
  scheduledAt?: string;
}
