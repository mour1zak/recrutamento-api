import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Patch, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { InterviewsService } from './interviews.service.js';
import { CreateInterviewDto } from './dto/create-interview.dto.js';
import { UpdateInterviewDto } from './dto/update-interview.dto.js';
import { Permissions } from '../common/decorators/permissions.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { PERMISSIONS } from '../common/constants/permissions.constants.js';
import type { AuthenticatedUser } from '../common/types/authenticated-user.js';

@Controller()
export class InterviewsController {
  constructor(private readonly interviewsService: InterviewsService) {}

  @Permissions(PERMISSIONS.INTERVIEW_CREATE)
  @Post('applications/:applicationId/interviews')
  create(@Param('applicationId', ParseIntPipe) applicationId: number, @Body() dto: CreateInterviewDto, @CurrentUser() user: AuthenticatedUser) {
    return this.interviewsService.create(applicationId, dto, user);
  }

  @Permissions(PERMISSIONS.INTERVIEW_READ)
  @Get('applications/:applicationId/interviews')
  findForApplication(@Param('applicationId', ParseIntPipe) applicationId: number, @CurrentUser() user: AuthenticatedUser) {
    return this.interviewsService.findForApplication(applicationId, user);
  }

  @Permissions(PERMISSIONS.INTERVIEW_READ)
  @Get('interviews/:id')
  findOne(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthenticatedUser) {
    return this.interviewsService.findOne(id, user);
  }

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
