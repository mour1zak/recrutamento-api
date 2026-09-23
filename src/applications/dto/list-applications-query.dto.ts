import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto.js';
import { ApplicationStatus } from '../../generated/prisma/client.js';

export class ListApplicationsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Filtra as candidaturas pelo status.', enum: ApplicationStatus })
  @IsOptional()
  @IsEnum(ApplicationStatus)
  status?: ApplicationStatus;
}
