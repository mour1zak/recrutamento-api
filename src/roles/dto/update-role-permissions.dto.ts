import { ApiProperty } from '@nestjs/swagger';
import { ArrayUnique, IsArray, IsInt } from 'class-validator';

export class UpdateRolePermissionsDto {
  // IDs numéricos de `Permission` (não a `key` string) — a rota do mapa
  // do DeepSeek fala em `permissionIds: string[]`, mas o schema desta
  // avaliação usa `id: Int` como chave primária de `Permission`; adaptado
  // pro tipo real, mesmo tipo de ajuste já documentado pra outras
  // divergências entre o plano original e o schema desta entrega.
  @ApiProperty({ description: 'Conjunto COMPLETO de IDs de Permission que a role deve ter após esta chamada (substitui o conjunto atual, não adiciona incrementalmente).', type: [Number] })
  @IsArray()
  @IsInt({ each: true })
  @ArrayUnique()
  permissionIds!: number[];
}
