import { IsInt } from 'class-validator';

export class UpdateUserRoleDto {
  @IsInt()
  roleId!: number;
}
