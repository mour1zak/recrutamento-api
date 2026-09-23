import { ApiProperty } from '@nestjs/swagger';
import { IsInt } from 'class-validator';

export class UpdateUserRoleDto {
  @ApiProperty({ description: 'ID do novo papel (`Role.id`) — pode ser um dos 3 papéis do enunciado ou um papel custom criado via RBAC Nível B.', example: 2 })
  @IsInt()
  roleId!: number;
}
