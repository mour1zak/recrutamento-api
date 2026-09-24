import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ApplicationsService } from './applications.service.js';
import { CreateApplicationDto } from './dto/create-application.dto.js';
import { UpdateApplicationStatusDto } from './dto/update-application-status.dto.js';
import { WithdrawApplicationDto } from './dto/withdraw-application.dto.js';
import { ListApplicationsQueryDto } from './dto/list-applications-query.dto.js';
import { Permissions } from '../common/decorators/permissions.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { PERMISSIONS } from '../common/constants/permissions.constants.js';
import { ApplicationStatus } from '../generated/prisma/client.js';
import type { AuthenticatedUser } from '../common/types/authenticated-user.js';

// Achado da revisão técnica (ressalva 1): espelha `toFullResponse`/
// `toReducedResponse` de `applications.service.ts` — a distinção
// completo × reduzido é a política de PII deste módulo (K5/K6, rodada
// 12) e não aparecia em nenhum schema publicado.
const FULL_APPLICATION_SCHEMA = {
  properties: {
    id: { type: 'integer' },
    jobId: { type: 'integer' },
    candidateId: { type: 'integer' },
    status: { type: 'string', enum: Object.values(ApplicationStatus) },
    coverLetter: { type: 'string', nullable: true },
    resumeDocumentId: { type: 'integer', nullable: true },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
    job: { properties: { id: { type: 'integer' }, title: { type: 'string' }, companyId: { type: 'integer' }, status: { type: 'string' }, vacancies: { type: 'integer' }, filledCount: { type: 'integer' } } },
    candidate: { properties: { id: { type: 'integer' }, name: { type: 'string' } } },
    resumeDocument: { nullable: true, properties: { id: { type: 'integer' }, filename: { type: 'string' }, mimeType: { type: 'string' }, sizeBytes: { type: 'integer' } } },
  },
} as const;

const REDUCED_APPLICATION_SCHEMA = {
  properties: {
    id: { type: 'integer' },
    jobId: { type: 'integer' },
    status: { type: 'string', enum: Object.values(ApplicationStatus) },
    coverLetter: { type: 'string', nullable: true },
    resumeDocument: { nullable: true, properties: { id: { type: 'integer' }, filename: { type: 'string' }, mimeType: { type: 'string' }, sizeBytes: { type: 'integer' } } },
    createdAt: { type: 'string', format: 'date-time' },
    candidate: { properties: { id: { type: 'integer' }, name: { type: 'string' }, headline: { type: 'string', nullable: true }, skills: { type: 'array', items: { type: 'string' } } } },
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

@ApiTags('Candidaturas')
@ApiSecurity('api-key')
@ApiBearerAuth('jwt')
@Controller()
export class ApplicationsController {
  constructor(private readonly applicationsService: ApplicationsService) {}

  @ApiOperation({ summary: 'Candidatar-se a uma vaga', description: 'Só CANDIDATE. Bloqueia candidatura duplicada e vaga fora de `OPEN`.' })
  @ApiParam({ name: 'jobId', type: Number })
  @ApiResponse({ status: 201, description: 'Candidatura criada.' })
  @ApiResponse({ status: 400, description: 'DTO inválido, ou `resumeDocumentId` que não pertence ao candidato.' })
  @ApiResponse({ status: 401, description: 'API key ou JWT ausente/inválido.' })
  @ApiResponse({ status: 403, description: 'Sem a permissão `application:create`.' })
  @ApiResponse({ status: 404, description: 'Vaga não encontrada, inativa, ou fora de `OPEN`.' })
  @ApiResponse({ status: 409, description: 'Candidatura duplicada para esta vaga (`reason: "candidatura_duplicada"`).' })
  @Permissions(PERMISSIONS.APPLICATION_CREATE)
  @Post('jobs/:jobId/applications')
  create(@Param('jobId', ParseIntPipe) jobId: number, @Body() dto: CreateApplicationDto, @CurrentUser() user: AuthenticatedUser) {
    return this.applicationsService.create(jobId, dto, user);
  }

  @ApiOperation({ summary: 'Listar as próprias candidaturas', description: 'Só CANDIDATE.' })
  @ApiResponse({ status: 200, description: 'Página de candidaturas do candidato autenticado — sempre completo (é o próprio dono).', schema: paginated(FULL_APPLICATION_SCHEMA) })
  @ApiResponse({ status: 401, description: 'API key ou JWT ausente/inválido.' })
  @ApiResponse({ status: 403, description: 'Sem a permissão `application:read:own`.' })
  @Permissions(PERMISSIONS.APPLICATION_READ_OWN)
  @Get('applications/me')
  findMine(@CurrentUser() user: AuthenticatedUser, @Query() query: ListApplicationsQueryDto) {
    return this.applicationsService.findMine(user, query);
  }

  @ApiOperation({ summary: 'Listar candidaturas de uma vaga', description: 'RECRUITER/ADMIN da empresa dona da vaga.' })
  @ApiParam({ name: 'jobId', type: Number })
  @ApiResponse({ status: 200, description: 'Página de candidaturas da vaga — sempre completo nesta listagem (a redução por status só se aplica em `GET /applications/:id`).', schema: paginated(FULL_APPLICATION_SCHEMA) })
  @ApiResponse({ status: 401, description: 'API key ou JWT ausente/inválido.' })
  @ApiResponse({ status: 403, description: 'Sem a permissão `application:read:job`.' })
  @ApiResponse({ status: 404, description: 'Vaga não encontrada, ou de empresa diferente da do usuário.' })
  @Permissions(PERMISSIONS.APPLICATION_READ_JOB)
  @Get('jobs/:jobId/applications')
  findForJob(@Param('jobId', ParseIntPipe) jobId: number, @CurrentUser() user: AuthenticatedUser, @Query() query: ListApplicationsQueryDto) {
    return this.applicationsService.findForJob(jobId, user, query);
  }

  @ApiOperation({
    summary: 'Buscar candidatura por ID',
    description:
      'Sem `@Permissions()` de propósito: o guard só faz E entre permissões, mas esta rota aceita OU — `application:read:own` (o próprio candidato), `application:read:job` (recrutador/admin da vaga) ou `application:read:any`. A checagem "tem pelo menos uma" e a decisão de payload completo/reduzido ficam no Service: um recrutador vendo a candidatura de outra empresa, ou um candidato vendo a de outro, recebe `404` (anti-enumeração), não `403`.',
  })
  @ApiParam({ name: 'id', type: Number })
  @ApiResponse({
    status: 200,
    description:
      'O candidato dono e o ADMIN sempre recebem o payload COMPLETO. RECRUITER da empresa da vaga recebe o REDUZIDO (sem `candidateId`/`resumeDocumentId`, com `candidate.headline`/`skills` em vez do perfil inteiro) enquanto a candidatura está `PENDING`; volta a completo a partir de `UNDER_REVIEW`/`INTERVIEW`/`OFFERED`/`HIRED`.',
    schema: { oneOf: [FULL_APPLICATION_SCHEMA, REDUCED_APPLICATION_SCHEMA] },
  })
  @ApiResponse({ status: 401, description: 'API key ou JWT ausente/inválido.' })
  @ApiResponse({ status: 403, description: 'Usuário autenticado sem nenhuma das permissões de leitura de candidatura.' })
  @ApiResponse({ status: 404, description: 'Candidatura não encontrada, ou não visível para este usuário (anti-enumeração).' })
  @Get('applications/:id')
  findOne(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthenticatedUser) {
    return this.applicationsService.findOne(id, user);
  }

  @ApiOperation({ summary: 'Atualizar status da candidatura', description: 'RECRUITER/ADMIN. `HIRED` roda a checagem atômica de capacidade da vaga.' })
  @ApiParam({ name: 'id', type: Number })
  @ApiResponse({ status: 200, description: 'Status atualizado.' })
  @ApiResponse({ status: 400, description: 'Transição de status inválida.' })
  @ApiResponse({ status: 401, description: 'API key ou JWT ausente/inválido.' })
  @ApiResponse({ status: 403, description: 'Sem a permissão `application:status:update`.' })
  @ApiResponse({ status: 404, description: 'Candidatura não encontrada, ou de empresa diferente da do usuário.' })
  @ApiResponse({ status: 409, description: 'Vaga já preenchida (`reason: "vaga_sem_vagas_disponiveis"`) ou invariante de vagas violada por corrida concorrente (`reason: "invariante_vagas_violada"`/`"concorrencia_transacao"`).' })
  @Permissions(PERMISSIONS.APPLICATION_STATUS_UPDATE)
  @Patch('applications/:id/status')
  updateStatus(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateApplicationStatusDto, @CurrentUser() user: AuthenticatedUser) {
    return this.applicationsService.updateStatus(id, dto, user);
  }

  @ApiOperation({ summary: 'Desistir da própria candidatura', description: 'Só o candidato dono da candidatura.' })
  @ApiParam({ name: 'id', type: Number })
  @ApiResponse({ status: 200, description: 'Candidatura marcada como `WITHDRAWN`.' })
  @ApiResponse({ status: 400, description: 'Candidatura em status terminal (já `HIRED`/`REJECTED`/`WITHDRAWN`).' })
  @ApiResponse({ status: 401, description: 'API key ou JWT ausente/inválido.' })
  @ApiResponse({ status: 403, description: 'Sem a permissão `application:withdraw:own`, ou candidatura de outro candidato.' })
  @ApiResponse({ status: 404, description: 'Candidatura não encontrada.' })
  @Permissions(PERMISSIONS.APPLICATION_WITHDRAW_OWN)
  @Patch('applications/:id/withdraw')
  withdraw(@Param('id', ParseIntPipe) id: number, @Body() dto: WithdrawApplicationDto, @CurrentUser() user: AuthenticatedUser) {
    return this.applicationsService.withdraw(id, dto, user);
  }
}
