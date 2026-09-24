import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto.js';

export class ListUsersQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Filtra por nome do papel (ex.: `ADMIN`, `RECRUITER`, `CANDIDATE`, ou um papel custom criado via RBAC Nível B).', example: 'RECRUITER' })
  @IsOptional()
  @IsString()
  role?: string;

  @ApiPropertyOptional({ description: 'Filtra por empresa (só faz sentido para usuários RECRUITER).' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  companyId?: number;

  // `@Type(() => Boolean)` usa `Boolean(value)` por baixo — em query
  // string, o valor sempre chega como string, e `Boolean("false")` é
  // `true` (qualquer string não-vazia é truthy em JS). Isso fazia
  // `?isActive=false` filtrar por `isActive: true` silenciosamente
  // (achado do usuário testando no Swagger, confirmado batendo direto
  // no servidor: `?isActive=false` e `?isActive=true` devolviam
  // exatamente a mesma lista). `@Transform` compara a STRING antes de
  // qualquer coerção automática.
  @ApiPropertyOptional({ description: 'Filtra por usuários ativos (`true`) ou desativados (`false`).' })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  })
  @IsBoolean()
  isActive?: boolean;
}
