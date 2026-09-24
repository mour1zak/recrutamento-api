import { Body, Controller, Get, Param, ParseIntPipe, Patch, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { UsersService } from './users.service.js';
import { Permissions } from '../common/decorators/permissions.decorator.js';
import { PERMISSIONS } from '../common/constants/permissions.constants.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { ListUsersQueryDto } from './dto/list-users-query.dto.js';
import { UpdateUserCompanyDto } from './dto/update-user-company.dto.js';
import { UpdateUserRoleDto } from './dto/update-user-role.dto.js';
import type { AuthenticatedUser } from '../common/types/authenticated-user.js';

// Primeiro endpoint protegido por permission key do projeto — serve
// também de prova de que a correção do achado C2 (ordem dos guards)
// funciona: usuário com `user:manage` → 2xx; sem a permissão →
// 403 (ver test/users.e2e-spec.ts).
//
// deactivate/reactivate devolvem `200` + o usuário atualizado (decisão
// pós-Fase-2, pensando no frontend): sem isso, quem chama a rota não
// tinha como confirmar `isActive` sem um GET extra. Antes disso, as duas
// respondiam `204` sem corpo — mudança só de contrato de resposta, a
// lógica de negócio auditada (trava de último admin, revogação de
// refresh tokens) continua idêntica.
//
// Nota sobre o formato de erro: `deactivate`/`reactivate` usam o formato
// ANTIGO ({statusCode, error, message}, sem `reason`) — já auditado e
// fechado desde a Fase 2. As outras 4 rotas (novas na Fase 4) usam o
// formato estruturado com `reason` (ver README §5).
@ApiTags('Usuários')
@ApiSecurity('api-key')
@ApiBearerAuth('jwt')
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @ApiOperation({ summary: 'Listar usuários', description: 'Lista paginada, com filtros opcionais por papel, empresa e status ativo/inativo.' })
  @ApiResponse({
    status: 200,
    description: 'Lista paginada de usuários (sem senha/hash de token).',
    schema: {
      properties: {
        data: {
          type: 'array',
          items: {
            properties: {
              id: { type: 'integer' },
              name: { type: 'string' },
              email: { type: 'string' },
              isActive: { type: 'boolean' },
              roleId: { type: 'integer' },
              companyId: { type: 'integer', nullable: true },
              createdAt: { type: 'string', format: 'date-time' },
              role: { properties: { name: { type: 'string' } } },
            },
          },
        },
        page: { type: 'integer' },
        limit: { type: 'integer' },
        total: { type: 'integer' },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'API key ou JWT ausente/inválido.' })
  @ApiResponse({ status: 403, description: 'Sem a permissão `user:read`.' })
  @Permissions(PERMISSIONS.USER_READ)
  @Get()
  findAll(@Query() query: ListUsersQueryDto) {
    return this.usersService.findAll(query);
  }

  @ApiOperation({ summary: 'Buscar usuário por ID' })
  @ApiParam({ name: 'id', type: Number })
  @ApiResponse({ status: 200, description: 'Usuário encontrado (sem senha/hash de token).' })
  @ApiResponse({ status: 401, description: 'API key ou JWT ausente/inválido.' })
  @ApiResponse({ status: 403, description: 'Sem a permissão `user:read`.' })
  @ApiResponse({ status: 404, description: 'Usuário não encontrado.' })
  @Permissions(PERMISSIONS.USER_READ)
  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.usersService.findOne(id);
  }

  @ApiOperation({ summary: 'Vincular/desvincular empresa de um recrutador', description: 'Só se aplica a usuários RECRUITER. `companyId: null` desvincula.' })
  @ApiParam({ name: 'id', type: Number })
  @ApiResponse({ status: 200, description: 'Empresa atualizada no usuário.' })
  @ApiResponse({ status: 400, description: '`companyId` ausente do corpo (`reason: "company_id_obrigatorio"`) — diferente de enviar `null`.' })
  @ApiResponse({ status: 401, description: 'API key ou JWT ausente/inválido.' })
  @ApiResponse({ status: 403, description: 'Sem a permissão `user:manage`.' })
  @ApiResponse({ status: 404, description: 'Usuário ou empresa não encontrado(a).' })
  @ApiResponse({ status: 409, description: 'O usuário-alvo não é RECRUITER (`reason: "usuario_nao_e_recrutador"`).' })
  @Permissions(PERMISSIONS.USER_MANAGE)
  @Patch(':id/company')
  updateCompany(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateUserCompanyDto) {
    return this.usersService.updateCompany(id, dto.companyId);
  }

  @ApiOperation({ summary: 'Trocar o papel de um usuário' })
  @ApiParam({ name: 'id', type: Number })
  @ApiResponse({ status: 200, description: 'Papel atualizado.' })
  @ApiResponse({ status: 401, description: 'API key ou JWT ausente/inválido.' })
  @ApiResponse({ status: 403, description: 'Sem a permissão `user:manage`.' })
  @ApiResponse({ status: 404, description: 'Usuário ou papel não encontrado.' })
  @ApiResponse({ status: 409, description: 'RECRUITER com vaga ainda em andamento (`reason: "recrutador_com_vagas_ativas"`), ou removeria o último ADMIN ativo (`reason: "last_active_admin"`), ou conflito de concorrência (`reason: "concorrencia_transacao"`).' })
  @Permissions(PERMISSIONS.USER_MANAGE)
  @Patch(':id/role')
  updateRole(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateUserRoleDto) {
    return this.usersService.updateRole(id, dto.roleId);
  }

  @ApiOperation({ summary: 'Desativar usuário', description: 'Soft-delete — nunca há remoção física. Revoga todos os refresh tokens ativos do usuário.' })
  @ApiParam({ name: 'id', type: Number })
  @ApiResponse({ status: 200, description: 'Usuário desativado (corpo com `isActive: false`).' })
  @ApiResponse({ status: 401, description: 'API key ou JWT ausente/inválido.' })
  @ApiResponse({ status: 403, description: 'Sem a permissão `user:manage`.' })
  @ApiResponse({ status: 404, description: 'Usuário não encontrado.' })
  @ApiResponse({ status: 409, description: 'Já está inativo, é a própria conta, é o último ADMIN ativo, ou conflito de concorrência.' })
  @Permissions(PERMISSIONS.USER_MANAGE)
  @Patch(':id/deactivate')
  deactivate(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthenticatedUser) {
    return this.usersService.deactivate(id, user.id);
  }

  // Achado da revisão técnica (N1-c): sem esta rota, uma desativação errada
  // (ex.: ADMIN desativa o recrutador errado) era irreversível pela API.
  @ApiOperation({ summary: 'Reativar usuário' })
  @ApiParam({ name: 'id', type: Number })
  @ApiResponse({ status: 200, description: 'Usuário reativado (corpo com `isActive: true`).' })
  @ApiResponse({ status: 401, description: 'API key ou JWT ausente/inválido.' })
  @ApiResponse({ status: 403, description: 'Sem a permissão `user:manage`.' })
  @ApiResponse({ status: 404, description: 'Usuário não encontrado.' })
  @ApiResponse({ status: 409, description: 'Já está ativo.' })
  @Permissions(PERMISSIONS.USER_MANAGE)
  @Patch(':id/reactivate')
  reactivate(@Param('id', ParseIntPipe) id: number) {
    return this.usersService.reactivate(id);
  }
}
