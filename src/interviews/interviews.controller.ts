import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Patch, Post, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiSecurity, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { InterviewsService } from './interviews.service.js';
import { CreateInterviewDto } from './dto/create-interview.dto.js';
import { UpdateInterviewDto } from './dto/update-interview.dto.js';
import { Permissions } from '../common/decorators/permissions.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { PERMISSIONS } from '../common/constants/permissions.constants.js';
import type { AuthenticatedUser } from '../common/types/authenticated-user.js';

@ApiTags('Entrevistas')
@ApiSecurity('api-key')
@ApiBearerAuth('jwt')
@Controller()
export class InterviewsController {
  constructor(private readonly interviewsService: InterviewsService) {}

  @ApiOperation({ summary: 'Agendar entrevista para uma candidatura', description: 'RECRUITER/ADMIN da empresa dona da vaga. Bloqueado se a candidatura estiver `WITHDRAWN`.' })
  @ApiParam({ name: 'applicationId', type: Number })
  @ApiResponse({ status: 201, description: 'Entrevista agendada.' })
  @ApiResponse({ status: 400, description: 'DTO inválido.' })
  @ApiResponse({ status: 401, description: 'API key ou JWT ausente/inválido.' })
  @ApiResponse({ status: 403, description: 'Sem a permissão `interview:create`.' })
  @ApiResponse({ status: 404, description: 'Candidatura não encontrada, ou de empresa diferente da do usuário.' })
  @ApiResponse({ status: 409, description: 'Candidatura em status que não admite entrevista (ex.: `WITHDRAWN`).' })
  @Permissions(PERMISSIONS.INTERVIEW_CREATE)
  @Post('applications/:applicationId/interviews')
  create(@Param('applicationId', ParseIntPipe) applicationId: number, @Body() dto: CreateInterviewDto, @CurrentUser() user: AuthenticatedUser) {
    return this.interviewsService.create(applicationId, dto, user);
  }

  @ApiOperation({ summary: 'Listar entrevistas de uma candidatura' })
  @ApiParam({ name: 'applicationId', type: Number })
  @ApiResponse({ status: 200, description: 'Lista de entrevistas da candidatura.' })
  @ApiResponse({ status: 401, description: 'API key ou JWT ausente/inválido.' })
  @ApiResponse({ status: 403, description: 'Sem a permissão `interview:read`.' })
  @ApiResponse({ status: 404, description: 'Candidatura não encontrada, ou não visível para o usuário.' })
  @Permissions(PERMISSIONS.INTERVIEW_READ)
  @Get('applications/:applicationId/interviews')
  findForApplication(@Param('applicationId', ParseIntPipe) applicationId: number, @CurrentUser() user: AuthenticatedUser) {
    return this.interviewsService.findForApplication(applicationId, user);
  }

  @ApiOperation({ summary: 'Buscar entrevista por ID' })
  @ApiParam({ name: 'id', type: Number })
  @ApiResponse({ status: 200, description: 'Entrevista encontrada.' })
  @ApiResponse({ status: 401, description: 'API key ou JWT ausente/inválido.' })
  @ApiResponse({ status: 403, description: 'Sem a permissão `interview:read`.' })
  @ApiResponse({ status: 404, description: 'Entrevista não encontrada, ou não visível para o usuário.' })
  @Permissions(PERMISSIONS.INTERVIEW_READ)
  @Get('interviews/:id')
  findOne(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthenticatedUser) {
    return this.interviewsService.findOne(id, user);
  }

  @ApiOperation({
    summary: 'Atualizar entrevista (status/feedback) ou reagendar',
    description:
      'Contrato de `RESCHEDULED` (definido pelo DeepSeek): enviar `status: "RESCHEDULED"` junto de um novo `scheduledAt` NÃO edita o registro atual — cria uma NOVA entrevista, e a resposta vem com HTTP `201` (em vez do `200` normal) contendo o novo registro. Entrevista em status terminal rejeita novas atualizações com `409`.',
  })
  @ApiParam({ name: 'id', type: Number })
  @ApiResponse({ status: 200, description: 'Entrevista atualizada (status/feedback), sem reagendamento.' })
  @ApiResponse({ status: 201, description: 'Reagendamento: nova entrevista criada com o `scheduledAt` informado.' })
  @ApiResponse({ status: 400, description: 'DTO inválido, ou `RESCHEDULED` sem `scheduledAt`.' })
  @ApiResponse({ status: 401, description: 'API key ou JWT ausente/inválido.' })
  @ApiResponse({ status: 403, description: 'Sem a permissão `interview:update`.' })
  @ApiResponse({ status: 404, description: 'Entrevista não encontrada, ou de empresa diferente da do usuário.' })
  @ApiResponse({ status: 409, description: 'Entrevista em status terminal.' })
  // Contrato de RESCHEDULED (DeepSeek §5): a mesma rota PATCH devolve `200`
  // normalmente, mas `201` com a NOVA entrevista quando o corpo pede
  // `status: "RESCHEDULED"` — `@Res({ passthrough: true })` deixa o Nest
  // serializar o corpo de retorno normalmente, só o status HTTP é
  // decidido a mão a partir do que o Service sinaliza.
  @Permissions(PERMISSIONS.INTERVIEW_UPDATE)
  @Patch('interviews/:id')
  @HttpCode(HttpStatus.OK)
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateInterviewDto,
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.interviewsService.update(id, dto, user);
    if (result.created) {
      res.status(HttpStatus.CREATED);
    }
    return result.interview;
  }
}
