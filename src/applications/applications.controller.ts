import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { ApplicationsService } from './applications.service.js';
import { CreateApplicationDto } from './dto/create-application.dto.js';
import { UpdateApplicationStatusDto } from './dto/update-application-status.dto.js';
import { WithdrawApplicationDto } from './dto/withdraw-application.dto.js';
import { ListApplicationsQueryDto } from './dto/list-applications-query.dto.js';
import { Permissions } from '../common/decorators/permissions.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { PERMISSIONS } from '../common/constants/permissions.constants.js';
import type { AuthenticatedUser } from '../common/types/authenticated-user.js';

@Controller()
export class ApplicationsController {
  constructor(private readonly applicationsService: ApplicationsService) {}

  @Permissions(PERMISSIONS.APPLICATION_CREATE)
  @Post('jobs/:jobId/applications')
  create(@Param('jobId', ParseIntPipe) jobId: number, @Body() dto: CreateApplicationDto, @CurrentUser() user: AuthenticatedUser) {
    return this.applicationsService.create(jobId, dto, user);
  }

  @Permissions(PERMISSIONS.APPLICATION_READ_OWN)
  @Get('applications/me')
  findMine(@CurrentUser() user: AuthenticatedUser, @Query() query: ListApplicationsQueryDto) {
    return this.applicationsService.findMine(user, query);
  }

  @Permissions(PERMISSIONS.APPLICATION_READ_JOB)
  @Get('jobs/:jobId/applications')
  findForJob(@Param('jobId', ParseIntPipe) jobId: number, @CurrentUser() user: AuthenticatedUser, @Query() query: ListApplicationsQueryDto) {
    return this.applicationsService.findForJob(jobId, user, query);
  }

  // Sem `@Permissions()` de propósito: o `PermissionsGuard` só sabe fazer
  // E (`every`) entre as keys pedidas, mas esta rota precisa de OU
  // (`read:own` OU `read:job` OU `read:any` — as 3 roles usam keys
  // diferentes pra chegar aqui). A checagem "tem pelo menos uma das três"
  // e a decisão de payload completo/reduzido/404 ficam dentro do Service.
  @Get('applications/:id')
  findOne(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthenticatedUser) {
    return this.applicationsService.findOne(id, user);
  }

  @Permissions(PERMISSIONS.APPLICATION_STATUS_UPDATE)
  @Patch('applications/:id/status')
  updateStatus(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateApplicationStatusDto, @CurrentUser() user: AuthenticatedUser) {
    return this.applicationsService.updateStatus(id, dto, user);
  }

  @Permissions(PERMISSIONS.APPLICATION_WITHDRAW_OWN)
  @Patch('applications/:id/withdraw')
  withdraw(@Param('id', ParseIntPipe) id: number, @Body() dto: WithdrawApplicationDto, @CurrentUser() user: AuthenticatedUser) {
    return this.applicationsService.withdraw(id, dto, user);
  }
}
