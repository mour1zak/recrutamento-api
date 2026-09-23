import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsInt, IsOptional } from 'class-validator';

export class CreateInterviewDto {
  @ApiProperty({ description: 'Data/hora agendada da entrevista, em formato ISO 8601.', example: '2026-10-01T14:00:00.000Z' })
  @IsDateString()
  scheduledAt!: string;

  @ApiPropertyOptional({ description: 'ID do usuário (RECRUITER/ADMIN) que conduzirá a entrevista.' })
  @IsOptional()
  @IsInt()
  interviewerId?: number;
}
