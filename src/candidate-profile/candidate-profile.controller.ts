import { Body, Controller, Get, Param, ParseIntPipe, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { CandidateProfileService } from './candidate-profile.service.js';
import { UpdateCandidateProfileDto } from './dto/update-candidate-profile.dto.js';
import { Permissions } from '../common/decorators/permissions.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { PERMISSIONS } from '../common/constants/permissions.constants.js';
import type { AuthenticatedUser } from '../common/types/authenticated-user.js';

@ApiTags('Perfil de Candidato')
@ApiSecurity('api-key')
@ApiBearerAuth('jwt')
@Controller('candidates')
export class CandidateProfileController {
  constructor(private readonly candidateProfileService: CandidateProfileService) {}

  @ApiOperation({ summary: 'Buscar o próprio perfil de candidato' })
  @ApiResponse({ status: 200, description: 'Perfil encontrado (vazio/`null` se ainda não preenchido).' })
  @ApiResponse({ status: 401, description: 'API key ou JWT ausente/inválido.' })
  @ApiResponse({ status: 403, description: 'Sem a permissão `candidate_profile:read`.' })
  // Precisa vir ANTES de `:userId` — mesmo motivo de `/jobs/mine` vs
  // `/jobs/:id`: senão o Nest tentaria casar "me" como valor numérico.
  @Permissions(PERMISSIONS.CANDIDATE_PROFILE_READ)
  @Get('me')
  getMine(@CurrentUser() user: AuthenticatedUser) {
    return this.candidateProfileService.getMine(user);
  }

  @ApiOperation({ summary: 'Criar/atualizar o próprio perfil de candidato', description: 'Upsert — cria na primeira chamada, atualiza parcialmente nas seguintes.' })
  @ApiResponse({ status: 200, description: 'Perfil criado/atualizado.' })
  @ApiResponse({ status: 400, description: 'DTO inválido, ou CEP que o provedor confirma não existir.' })
  @ApiResponse({ status: 401, description: 'API key ou JWT ausente/inválido.' })
  @ApiResponse({ status: 403, description: 'Sem a permissão `candidate_profile:update:own`.' })
  @Permissions(PERMISSIONS.CANDIDATE_PROFILE_UPDATE_OWN)
  @Patch('me')
  upsertMine(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateCandidateProfileDto) {
    return this.candidateProfileService.upsertMine(user, dto);
  }

  @ApiOperation({ summary: 'Buscar perfil de candidato por ID de usuário', description: 'Uso de recrutador/admin para consultar o perfil de um candidato específico.' })
  @ApiParam({ name: 'userId', type: Number })
  @ApiResponse({ status: 200, description: 'Perfil encontrado.' })
  @ApiResponse({ status: 401, description: 'API key ou JWT ausente/inválido.' })
  @ApiResponse({ status: 403, description: 'Sem a permissão `candidate_profile:read`.' })
  @ApiResponse({ status: 404, description: 'Usuário/perfil não encontrado.' })
  @Permissions(PERMISSIONS.CANDIDATE_PROFILE_READ)
  @Get(':userId')
  getByUserId(@Param('userId', ParseIntPipe) userId: number, @CurrentUser() user: AuthenticatedUser) {
    return this.candidateProfileService.getByUserId(userId, user);
  }
}
