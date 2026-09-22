import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

// Padronizado a partir de Jobs (achado/sugestão DeepSeek, mapa de
// endpoints §11.3: "padronizar ?page&limit em todas as listagens desde
// já") — todo endpoint de listagem futuro (Applications, Interviews,
// Documents, Users) estende esta classe em vez de repetir os mesmos
// dois campos.
export class PaginationQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}
