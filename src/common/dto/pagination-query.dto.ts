import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

// Padronizado a partir de Jobs (achado/sugestão DeepSeek, mapa de
// endpoints §11.3: "padronizar ?page&limit em todas as listagens desde
// já") — todo endpoint de listagem futuro (Applications, Interviews,
// Documents, Users) estende esta classe em vez de repetir os mesmos
// dois campos.
export class PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Número da página (começa em 1).', minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ description: 'Quantidade de itens por página.', minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}
