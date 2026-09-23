import { Body, Controller, Get, Param, ParseIntPipe, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { RolesService } from './roles.service.js';
import { UpdateRolePermissionsDto } from './dto/update-role-permissions.dto.js';
import { Permissions } from '../common/decorators/permissions.decorator.js';
import { PERMISSIONS } from '../common/constants/permissions.constants.js';

@ApiTags('Papéis (RBAC)')
@ApiSecurity('api-key')
@ApiBearerAuth('jwt')
@Controller('roles')
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  @ApiOperation({ summary: 'Listar todas as roles' })
  @ApiResponse({ status: 200, description: 'Lista de roles com suas permissões.' })
  @ApiResponse({ status: 401, description: 'API key ou JWT ausente/inválido.' })
  @ApiResponse({ status: 403, description: 'Sem a permissão `role:manage`.' })
  @Permissions(PERMISSIONS.ROLE_MANAGE)
  @Get()
  findAll() {
    return this.rolesService.findAll();
  }

  @ApiOperation({ summary: 'Buscar role por ID' })
  @ApiParam({ name: 'id', type: Number })
  @ApiResponse({ status: 200, description: 'Role encontrada, com suas permissões.' })
  @ApiResponse({ status: 401, description: 'API key ou JWT ausente/inválido.' })
  @ApiResponse({ status: 403, description: 'Sem a permissão `role:manage`.' })
  @ApiResponse({ status: 404, description: 'Role não encontrada.' })
  @Permissions(PERMISSIONS.ROLE_MANAGE)
  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.rolesService.findOne(id);
  }

  @ApiOperation({ summary: 'Substituir as permissões de uma role', description: 'Substitui o conjunto inteiro (não incremental) dentro de uma transação `Serializable`. Bloqueado se resultar em zero roles com `role:manage` no sistema.' })
  @ApiParam({ name: 'id', type: Number })
  @ApiResponse({ status: 200, description: 'Permissões substituídas.' })
  @ApiResponse({ status: 400, description: 'Algum `permissionId` não existe.' })
  @ApiResponse({ status: 401, description: 'API key ou JWT ausente/inválido.' })
  @ApiResponse({ status: 403, description: 'Sem a permissão `role:manage`.' })
  @ApiResponse({ status: 404, description: 'Role não encontrada.' })
  @ApiResponse({ status: 409, description: 'Resultaria em zero roles com `role:manage` (`reason: "sem_papel_com_role_manage"`), ou conflito de transação concorrente (`reason: "concorrencia_transacao"`).' })
  @Permissions(PERMISSIONS.ROLE_MANAGE)
  @Put(':id/permissions')
  updatePermissions(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateRolePermissionsDto) {
    return this.rolesService.updatePermissions(id, dto.permissionIds);
  }
}
