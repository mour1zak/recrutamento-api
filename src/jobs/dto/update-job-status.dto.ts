import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { JobStatus } from '../../generated/prisma/client.js';

export class UpdateJobStatusDto {
  @ApiProperty({ description: 'Novo status da vaga. `CANCELED` é o soft-delete oficial (não há rota de exclusão).', enum: JobStatus })
  @IsEnum(JobStatus)
  status!: JobStatus;
}
