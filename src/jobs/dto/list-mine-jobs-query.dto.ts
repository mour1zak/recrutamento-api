import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto.js';
import { JobStatus } from '../../generated/prisma/client.js';

export class ListMineJobsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Filtra as vagas da empresa/recrutador pelo status.', enum: JobStatus })
  @IsOptional()
  @IsEnum(JobStatus)
  status?: JobStatus;
}
