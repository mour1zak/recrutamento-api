import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
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
import type { AuthenticatedUser } from '../common/types/authenticated-user.js';

@Controller('jobs')
export class JobsController {
  constructor(private readonly jobsService: JobsService) {}

  @Permissions(PERMISSIONS.JOB_CREATE)
  @Post()
  create(@Body() dto: CreateJobDto, @CurrentUser() user: AuthenticatedUser) {
    return this.jobsService.create(dto, user);
  }

  // Sem @Permissions: rota pública (só API key), lista só vagas OPEN —
  // é a "vitrine" de vagas, quem ainda nem se candidatou pode navegar.
  @Public()
  @Get()
  findPublicList(@Query() query: ListJobsQueryDto) {
    return this.jobsService.findPublicList(query);
  }

  // Precisa vir ANTES de `:id` — senão o Nest tentaria casar "mine" como
  // valor de `:id` (ParseIntPipe rejeitaria com 400 antes de chegar aqui).
  @Permissions(PERMISSIONS.JOB_READ_ANY)
  @Get('mine')
  findMine(@CurrentUser() user: AuthenticatedUser, @Query() query: ListMineJobsQueryDto) {
    return this.jobsService.findMine(user, query);
  }

  // `job:read` é suficiente pra chegar aqui (as 3 roles têm essa key) —
  // a regra "só vê fora de OPEN se for da própria empresa" é decidida
  // dentro do Service, não no Guard, porque depende do estado da vaga.
  @Permissions(PERMISSIONS.JOB_READ)
  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthenticatedUser) {
    return this.jobsService.findOne(id, user);
  }

  @Permissions(PERMISSIONS.JOB_UPDATE)
  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateJobDto, @CurrentUser() user: AuthenticatedUser) {
    return this.jobsService.update(id, dto, user);
  }

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
