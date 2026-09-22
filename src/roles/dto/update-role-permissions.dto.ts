import { ArrayUnique, IsArray, IsInt } from 'class-validator';

export class UpdateRolePermissionsDto {
  // IDs numéricos de `Permission` (não a `key` string) — a rota do mapa
  // do DeepSeek fala em `permissionIds: string[]`, mas o schema desta
  // avaliação usa `id: Int` como chave primária de `Permission`; adaptado
  // pro tipo real, mesmo tipo de ajuste já documentado pra outras
  // divergências entre o plano original e o schema desta entrega.
  @IsArray()
  @IsInt({ each: true })
  @ArrayUnique()
  permissionIds!: number[];
}
