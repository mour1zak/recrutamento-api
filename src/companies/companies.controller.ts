import { Controller, Get, Param, ParseIntPipe, Patch, Post, Body } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { CompaniesService } from './companies.service.js';
import { CreateCompanyDto } from './dto/create-company.dto.js';
import { UpdateCompanyDto } from './dto/update-company.dto.js';
import { Permissions } from '../common/decorators/permissions.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { PERMISSIONS } from '../common/constants/permissions.constants.js';
import type { AuthenticatedUser } from '../common/types/authenticated-user.js';

// Primeiro módulo de domínio além de Auth/Users — mesma trinca de guards
// globais (API key → JWT → permission) se aplica sem nada extra aqui.
@ApiTags('Empresas')
@ApiSecurity('api-key')
@ApiBearerAuth('jwt')
@Controller('companies')
export class CompaniesController {
  constructor(private readonly companiesService: CompaniesService) {}

  @ApiOperation({ summary: 'Criar empresa', description: 'Só ADMIN. O CEP é validado contra o provedor externo antes de criar.' })
  @ApiResponse({ status: 201, description: 'Empresa criada, com endereço enriquecido pelo CEP (se resolvido).' })
  @ApiResponse({ status: 400, description: 'DTO inválido, ou CEP que o provedor confirma não existir (`reason: "cep_nao_encontrado"`).' })
  @ApiResponse({ status: 401, description: 'API key ou JWT ausente/inválido.' })
  @ApiResponse({ status: 403, description: 'Sem a permissão `company:create`.' })
  @ApiResponse({ status: 409, description: 'CNPJ já cadastrado (`reason: "cnpj_duplicado"`).' })
  @Permissions(PERMISSIONS.COMPANY_CREATE)
  @Post()
  create(@Body() dto: CreateCompanyDto) {
    return this.companiesService.create(dto);
  }

  @ApiOperation({ summary: 'Buscar empresa por ID', description: 'Empresa desativada é tratada como inexistente (anti-enumeração).' })
  @ApiParam({ name: 'id', type: Number })
  @ApiResponse({ status: 200, description: 'Empresa encontrada e ativa.' })
  @ApiResponse({ status: 401, description: 'API key ou JWT ausente/inválido.' })
  @ApiResponse({ status: 403, description: 'Sem a permissão `company:read`.' })
  @ApiResponse({ status: 404, description: 'Não encontrada (inexistente ou desativada).' })
  @Permissions(PERMISSIONS.COMPANY_READ)
  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.companiesService.findActiveOrThrow(id);
  }

  @ApiOperation({ summary: 'Atualizar empresa' })
  @ApiParam({ name: 'id', type: Number })
  @ApiResponse({ status: 200, description: 'Empresa atualizada.' })
  @ApiResponse({ status: 400, description: 'DTO inválido, ou CEP que o provedor confirma não existir.' })
  @ApiResponse({ status: 401, description: 'API key ou JWT ausente/inválido.' })
  @ApiResponse({ status: 403, description: 'Sem a permissão `company:update`.' })
  @ApiResponse({ status: 404, description: 'Não encontrada (inexistente ou desativada).' })
  @Permissions(PERMISSIONS.COMPANY_UPDATE)
  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateCompanyDto) {
    return this.companiesService.update(id, dto);
  }

  // 200 + o estado atualizado (decisão pós-Fase-2, pensando no frontend):
  // quem chama a rota confirma `isActive` na hora, sem precisar de um GET
  // extra. Users.deactivate/reactivate segue o mesmo padrão agora, pra
  // manter as duas entidades consistentes.
  @ApiOperation({ summary: 'Desativar empresa', description: 'Soft-delete — não cascateia pra vagas/usuários. Bloqueia acesso de seus recrutadores em todos os módulos (Jobs, Applications, Interviews, Documents).' })
  @ApiParam({ name: 'id', type: Number })
  @ApiResponse({ status: 200, description: 'Empresa desativada (`isActive: false`).' })
  @ApiResponse({ status: 401, description: 'API key ou JWT ausente/inválido.' })
  @ApiResponse({ status: 403, description: 'Sem a permissão `company:delete`.' })
  @ApiResponse({ status: 404, description: 'Empresa não encontrada.' })
  @ApiResponse({ status: 409, description: 'Já está inativa (`reason: "company_already_inactive"`).' })
  @Permissions(PERMISSIONS.COMPANY_DELETE)
  @Patch(':id/deactivate')
  deactivate(@Param('id', ParseIntPipe) id: number) {
    return this.companiesService.deactivate(id);
  }

  @ApiOperation({ summary: 'Reativar empresa' })
  @ApiParam({ name: 'id', type: Number })
  @ApiResponse({ status: 200, description: 'Empresa reativada (`isActive: true`).' })
  @ApiResponse({ status: 401, description: 'API key ou JWT ausente/inválido.' })
  @ApiResponse({ status: 403, description: 'Sem a permissão `company:delete`.' })
  @ApiResponse({ status: 404, description: 'Empresa não encontrada.' })
  @ApiResponse({ status: 409, description: 'Já está ativa (`reason: "company_already_active"`).' })
  @Permissions(PERMISSIONS.COMPANY_DELETE)
  @Patch(':id/reactivate')
  reactivate(@Param('id', ParseIntPipe) id: number) {
    return this.companiesService.reactivate(id);
  }

  @ApiOperation({
    summary: 'Indicadores de negócio da empresa',
    description:
      'Bônus "indicadores do domínio": vagas por status, funil de candidaturas por status, taxa de conversão e tempo médio até contratação. RECRUITER só vê a própria empresa (dados agregados de contratação são mais sensíveis que nome/endereço); ADMIN vê qualquer uma.',
  })
  @ApiParam({ name: 'id', type: Number })
  @ApiResponse({
    status: 200,
    description: 'Indicadores calculados a partir dos dados reais da empresa.',
    schema: {
      properties: {
        companyId: { type: 'integer' },
        jobs: { properties: { total: { type: 'integer' }, byStatus: { type: 'object' } } },
        applications: {
          properties: {
            total: { type: 'integer' },
            byStatus: { type: 'object' },
            conversionRate: { type: 'number', nullable: true, description: 'HIRED / total de candidaturas, ou null sem candidaturas.' },
            avgTimeToHireDays: { type: 'number', nullable: true, description: 'Média de dias entre a criação da candidatura e a transição para HIRED, ou null sem nenhuma contratação.' },
          },
        },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'API key ou JWT ausente/inválido.' })
  @ApiResponse({ status: 403, description: 'Sem a permissão `company:read`.' })
  @ApiResponse({ status: 404, description: 'Empresa não encontrada, inativa, ou (RECRUITER) de outra empresa.' })
  @Permissions(PERMISSIONS.COMPANY_READ)
  @Get(':id/stats')
  getStats(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthenticatedUser) {
    return this.companiesService.getStats(id, user);
  }
}
