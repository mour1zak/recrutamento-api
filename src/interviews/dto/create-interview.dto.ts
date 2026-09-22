import { IsDateString, IsInt, IsOptional } from 'class-validator';

export class CreateInterviewDto {
  @IsDateString()
  scheduledAt!: string;

  @IsOptional()
  @IsInt()
  interviewerId?: number;
}
