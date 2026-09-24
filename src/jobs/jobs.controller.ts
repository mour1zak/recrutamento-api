import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { JobsService } from './jobs.service.js';
import { CreateJobDto } from './dto/create-job.dto.js';
import { UpdateJobDto } from './dto/update-job.dto.js';
import { UpdateJobStatusDto } from './dto/update-job-status.dto.js';
import { ListJobsQueryDto } from './dto/list-jobs-query.dto.js';
import { ListMineJobsQueryDto } from './dto/list-mine-jobs-query.dto.js';
import { Permissions } from '../common/decorators/permissions.decorator.js';
import { Public } from '../common/decorators/public.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { PERMISSIONS } from '../common/constants/permissions.constants.js';
import { JobStatus } from '../generated/prisma/client.js';
import type { AuthenticatedUser } from '../common/types/authenticated-user.js';

// Achado Qwen rodada 15 (ressalva 1): nenhuma das 175 respostas do
// documento tinha `schema` — o envelope de paginação e a distinção entre
// campos de `PUBLIC_JOB_SELECT` (vitrine) e `SCOPED_JOB_INCLUDE`
// (autenticado, com `filledCount`/`companyId`/`createdById`) não
// apareciam em lugar nenhum. Espelha exatamente os `select`/`include` de
// `jobs.service.ts`.
const PUBLIC_JOB_ITEM_SCHEMA = {
  properties: {
    id: { type: 'integer' },
    title: { type: 'string' },
    description: { type: 'string' },
    isRemote: { type: 'boolean' },
    salaryMin: { type: 'integer', nullable: true },
    salaryMax: { type: 'integer', nullable: true },
    vacancies: { type: 'integer' },
    status: { type: 'string', enum: Object.values(JobStatus) },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
    closedAt: { type: 'string', format: 'date-time', nullable: true },
    company: { properties: { id: { type: 'integer' }, name: { type: 'string' } } },
  },
} as const;

const SCOPED_JOB_ITEM_SCHEMA = {
  properties: {
    ...PUBLIC_JOB_ITEM_SCHEMA.properties,
    companyId: { type: 'integer' },
    createdById: { type: 'integer' },
    filledCount: { type: 'integer' },
  },
} as const;

function paginated(itemSchema: object) {
  return {
    properties: {
      data: { type: 'array', items: itemSchema },
      page: { type: 'integer' },
      limit: { type: 'integer' },
      total: { type: 'integer' },
    },
  };
}

@ApiTags('Vagas')
@ApiSecurity('api-key')
@Controller('jobs')
export class JobsController {
  constructor(private readonly jobsService: JobsService) {}

  @ApiOperation({ summary: 'Criar vaga', description: 'RECRUITER cria na própria empresa automaticamente; ADMIN precisa informar `companyId`.' })
  @ApiResponse({ status: 201, description: 'Vaga criada.' })
  @ApiResponse({ status: 400, description: 'DTO inválido, ou `companyId` ausente para ADMIN.' })
  @ApiResponse({ status: 401, description: 'API key ou JWT ausente/inválido.' })
  @ApiResponse({ status: 403, description: 'Sem a permissão `job:create`.' })
  @ApiResponse({ status: 404, description: 'Empresa informada não encontrada/inativa (RECRUITER tentando outra empresa que não a própria também cai aqui, anti-enumeração).' })
  @ApiBearerAuth('jwt')
  @Permissions(PERMISSIONS.JOB_CREATE)
  @Post()
  create(@Body() dto: CreateJobDto, @CurrentUser() user: AuthenticatedUser) {
    return this.jobsService.create(dto, user);
  }

  @ApiOperation({ summary: 'Listar vagas públicas (vitrine)', description: 'Só API key — sem autenticação de usuário. Lista apenas vagas com status `OPEN`.' })
  @ApiResponse({ status: 200, description: 'Página de vagas abertas — sem `companyId`/`createdById`/`filledCount` (não pertencem a uma vitrine pública).', schema: paginated(PUBLIC_JOB_ITEM_SCHEMA) })
  @ApiResponse({ status: 401, description: 'API key ausente/inválida.' })
  // Sem @Permissions: rota pública (só API key), lista só vagas OPEN —
  // é a "vitrine" de vagas, quem ainda nem se candidatou pode navegar.
  @Public()
  @Get()
  findPublicList(@Query() query: ListJobsQueryDto) {
    return this.jobsService.findPublicList(query);
  }

  @ApiOperation({ summary: 'Listar vagas da própria empresa', description: 'ADMIN vê de todas as empresas; RECRUITER só da própria. Qualquer status, com filtro opcional.' })
  @ApiResponse({ status: 200, description: 'Página de vagas, com os campos internos (`companyId`, `createdById`, `filledCount`) que a vitrine pública omite.', schema: paginated(SCOPED_JOB_ITEM_SCHEMA) })
  @ApiResponse({ status: 401, description: 'API key ou JWT ausente/inválido.' })
  @ApiResponse({ status: 403, description: 'Sem a permissão `job:read:any`.' })
  @ApiBearerAuth('jwt')
  // Precisa vir ANTES de `:id` — senão o Nest tentaria casar "mine" como
  // valor de `:id` (ParseIntPipe rejeitaria com 400 antes de chegar aqui).
  @Permissions(PERMISSIONS.JOB_READ_ANY)
  @Get('mine')
  findMine(@CurrentUser() user: AuthenticatedUser, @Query() query: ListMineJobsQueryDto) {
    return this.jobsService.findMine(user, query);
  }

  @ApiOperation({ summary: 'Buscar vaga por ID', description: 'Vaga fora de `OPEN` só é visível para usuários da própria empresa dona da vaga (ou ADMIN).' })
  @ApiParam({ name: 'id', type: Number })
  @ApiResponse({ status: 200, description: 'Vaga encontrada e visível para o usuário.', schema: SCOPED_JOB_ITEM_SCHEMA })
  @ApiResponse({ status: 401, description: 'API key ou JWT ausente/inválido.' })
  @ApiResponse({ status: 403, description: 'Sem a permissão `job:read`.' })
  @ApiResponse({ status: 404, description: 'Vaga inexistente, ou fora de `OPEN` e de empresa diferente da do usuário (anti-enumeração).' })
  @ApiBearerAuth('jwt')
  // `job:read` é suficiente pra chegar aqui (as 3 roles têm essa key) —
  // a regra "só vê fora de OPEN se for da própria empresa" é decidida
  // dentro do Service, não no Guard, porque depende do estado da vaga.
  @Permissions(PERMISSIONS.JOB_READ)
  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthenticatedUser) {
    return this.jobsService.findOne(id, user);
  }

  @ApiOperation({ summary: 'Atualizar vaga' })
  @ApiParam({ name: 'id', type: Number })
  @ApiResponse({ status: 200, description: 'Vaga atualizada.' })
  @ApiResponse({ status: 400, description: 'DTO inválido, ou `vacancies` menor que `filledCount` atual.' })
  @ApiResponse({ status: 401, description: 'API key ou JWT ausente/inválido.' })
  @ApiResponse({ status: 403, description: 'Sem a permissão `job:update`.' })
  @ApiResponse({ status: 404, description: 'Vaga não encontrada, ou de empresa diferente da do usuário.' })
  @ApiBearerAuth('jwt')
  @Permissions(PERMISSIONS.JOB_UPDATE)
  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateJobDto, @CurrentUser() user: AuthenticatedUser) {
    return this.jobsService.update(id, dto, user);
  }

  @ApiOperation({ summary: 'Atualizar status da vaga', description: '`CANCELED` é o soft-delete oficial — não há rota de exclusão. Preserva o histórico de candidaturas/entrevistas/documentos vinculados.' })
  @ApiParam({ name: 'id', type: Number })
  @ApiResponse({ status: 200, description: 'Status atualizado.' })
  @ApiResponse({ status: 400, description: 'Transição de status inválida.' })
  @ApiResponse({ status: 401, description: 'API key ou JWT ausente/inválido.' })
  @ApiResponse({ status: 403, description: 'Sem a permissão `job:status:update`.' })
  @ApiResponse({ status: 404, description: 'Vaga não encontrada, ou de empresa diferente da do usuário.' })
  @ApiBearerAuth('jwt')
  @Permissions(PERMISSIONS.JOB_STATUS_UPDATE)
  @Patch(':id/status')
  updateStatus(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateJobStatusDto, @CurrentUser() user: AuthenticatedUser) {
    return this.jobsService.updateStatus(id, dto, user);
  }

  // DELETE /jobs/:id deliberadamente não exposto (decisão registrada em
  // PARECER-DEEPSEEK-FASE2-ENDPOINTS.md §2): soft-delete via
  // PATCH /jobs/:id/status {status: "CANCELED"} preserva o histórico de
  // candidaturas/entrevistas/documentos vinculados. `job:delete` fica
  // reservada no catálogo, sem rota.
}
