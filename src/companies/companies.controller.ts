import { Controller, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Patch, Post, Body } from '@nestjs/common';
import { CompaniesService } from './companies.service.js';
import { CreateCompanyDto } from './dto/create-company.dto.js';
import { UpdateCompanyDto } from './dto/update-company.dto.js';
import { Permissions } from '../common/decorators/permissions.decorator.js';
import { PERMISSIONS } from '../common/constants/permissions.constants.js';

// Primeiro módulo de domínio além de Auth/Users — mesma trinca de guards
// globais (API key → JWT → permission) se aplica sem nada extra aqui.
@Controller('companies')
export class CompaniesController {
  constructor(private readonly companiesService: CompaniesService) {}

  @Permissions(PERMISSIONS.COMPANY_CREATE)
  @Post()
  create(@Body() dto: CreateCompanyDto) {
    return this.companiesService.create(dto);
  }

  @Permissions(PERMISSIONS.COMPANY_READ)
  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.companiesService.findActiveOrThrow(id);
  }

  @Permissions(PERMISSIONS.COMPANY_UPDATE)
  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateCompanyDto) {
    return this.companiesService.update(id, dto);
  }

  // 204 sem corpo, não 200 com o estado (desenho original do DeepSeek) —
  // decisão consciente de consistência com PATCH /users/:id/deactivate,
  // já auditado: todo "deactivate/reactivate" do projeto responde igual,
  // em qualquer entidade.
  @Permissions(PERMISSIONS.COMPANY_DELETE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @Patch(':id/deactivate')
  deactivate(@Param('id', ParseIntPipe) id: number) {
    return this.companiesService.deactivate(id);
  }

  @Permissions(PERMISSIONS.COMPANY_DELETE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @Patch(':id/reactivate')
  reactivate(@Param('id', ParseIntPipe) id: number) {
    return this.companiesService.reactivate(id);
  }
}
