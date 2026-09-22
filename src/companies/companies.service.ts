import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CepService } from '../common/cep/cep.service.js';
import { errorBody } from '../common/exceptions/error-body.util.js';
import { CreateCompanyDto } from './dto/create-company.dto.js';
import { UpdateCompanyDto } from './dto/update-company.dto.js';

function normalizeCnpj(cnpj: string): string {
  return cnpj.replace(/\D/g, '');
}

@Injectable()
export class CompaniesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cepService: CepService,
  ) {}

  async create(dto: CreateCompanyDto) {
    // Falha de CEP nunca bloqueia a criação (ver CepService) — endereço
    // fica null e a empresa é criada normalmente.
    const address = await this.cepService.resolve(dto.cep);

    // Sem checagem prévia de "CNPJ já existe" (mesmo padrão de
    // createCandidate em users.service.ts): checar-então-criar tem janela
    // de corrida. O `@@unique(cnpj)` do banco garante a regra; o P2002
    // vira 409 com reason "cnpj_duplicado" no GlobalExceptionFilter.
    return this.prisma.company.create({
      data: {
        name: dto.name,
        cnpj: dto.cnpj ? normalizeCnpj(dto.cnpj) : undefined,
        description: dto.description,
        cep: dto.cep,
        street: address.street,
        city: address.city,
        state: address.state,
      },
    });
  }

  async findActiveOrThrow(id: number) {
    const company = await this.prisma.company.findUnique({ where: { id } });
    if (!company || !company.isActive) {
      throw new NotFoundException(errorBody(404, 'company_not_found', 'Empresa não encontrada.'));
    }
    return company;
  }

  async update(id: number, dto: UpdateCompanyDto) {
    await this.findActiveOrThrow(id);

    const address = dto.cep ? await this.cepService.resolve(dto.cep) : undefined;

    return this.prisma.company.update({
      where: { id },
      data: {
        name: dto.name,
        cnpj: dto.cnpj ? normalizeCnpj(dto.cnpj) : undefined,
        description: dto.description,
        cep: dto.cep,
        street: address?.street,
        city: address?.city,
        state: address?.state,
      },
    });
  }

  async deactivate(id: number) {
    const company = await this.prisma.company.findUnique({ where: { id } });
    if (!company) {
      throw new NotFoundException(errorBody(404, 'company_not_found', 'Empresa não encontrada.'));
    }
    if (!company.isActive) {
      throw new NotFoundException(errorBody(404, 'company_already_inactive', 'Empresa já está inativa.'));
    }

    // Achado Qwen rodada 3 (C5): desativar empresa é soft-delete, nunca
    // DELETE físico — preserva a evidência de quem foi recrutador dela.
    // Não cascateia pra vagas/usuários (decisão registrada no README):
    // Job.companyId e User.companyId continuam apontando pra empresa
    // inativa, e é responsabilidade do módulo de Jobs tratar isso quando
    // existir.
    return this.prisma.company.update({ where: { id }, data: { isActive: false } });
  }

  async reactivate(id: number) {
    const company = await this.prisma.company.findUnique({ where: { id } });
    if (!company) {
      throw new NotFoundException(errorBody(404, 'company_not_found', 'Empresa não encontrada.'));
    }
    if (company.isActive) {
      throw new NotFoundException(errorBody(404, 'company_already_active', 'Empresa já está ativa.'));
    }

    return this.prisma.company.update({ where: { id }, data: { isActive: true } });
  }
}
