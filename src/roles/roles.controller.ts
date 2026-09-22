import { Body, Controller, Get, Param, ParseIntPipe, Put } from '@nestjs/common';
import { RolesService } from './roles.service.js';
import { UpdateRolePermissionsDto } from './dto/update-role-permissions.dto.js';
import { Permissions } from '../common/decorators/permissions.decorator.js';
import { PERMISSIONS } from '../common/constants/permissions.constants.js';

@Controller('roles')
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  @Permissions(PERMISSIONS.ROLE_MANAGE)
  @Get()
  findAll() {
    return this.rolesService.findAll();
  }

  @Permissions(PERMISSIONS.ROLE_MANAGE)
  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.rolesService.findOne(id);
  }

  @Permissions(PERMISSIONS.ROLE_MANAGE)
  @Put(':id/permissions')
  updatePermissions(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateRolePermissionsDto) {
    return this.rolesService.updatePermissions(id, dto.permissionIds);
  }
}
