import { IsDateString, IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { InterviewStatus } from '../../generated/prisma/client.js';

export class UpdateInterviewDto {
  @IsOptional()
  @IsEnum(InterviewStatus)
  status?: InterviewStatus;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  feedback?: string;

  // Só usado quando `status: "RESCHEDULED"` (vira o `scheduledAt` da NOVA
  // entrevista criada) — contrato definido pelo DeepSeek (Fase 2,
  // mapa de endpoints §5).
  @IsOptional()
  @IsDateString()
  scheduledAt?: string;
}
