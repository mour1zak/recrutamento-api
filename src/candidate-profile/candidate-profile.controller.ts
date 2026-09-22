import { Body, Controller, Get, Param, ParseIntPipe, Patch } from '@nestjs/common';
import { CandidateProfileService } from './candidate-profile.service.js';
import { UpdateCandidateProfileDto } from './dto/update-candidate-profile.dto.js';
import { Permissions } from '../common/decorators/permissions.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { PERMISSIONS } from '../common/constants/permissions.constants.js';
import type { AuthenticatedUser } from '../common/types/authenticated-user.js';

@Controller('candidates')
export class CandidateProfileController {
  constructor(private readonly candidateProfileService: CandidateProfileService) {}

  // Precisa vir ANTES de `:userId` — mesmo motivo de `/jobs/mine` vs
  // `/jobs/:id`: senão o Nest tentaria casar "me" como valor numérico.
  @Permissions(PERMISSIONS.CANDIDATE_PROFILE_READ)
  @Get('me')
  getMine(@CurrentUser() user: AuthenticatedUser) {
    return this.candidateProfileService.getMine(user);
  }

  @Permissions(PERMISSIONS.CANDIDATE_PROFILE_UPDATE_OWN)
  @Patch('me')
  upsertMine(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateCandidateProfileDto) {
    return this.candidateProfileService.upsertMine(user, dto);
  }

  @Permissions(PERMISSIONS.CANDIDATE_PROFILE_READ)
  @Get(':userId')
  getByUserId(@Param('userId', ParseIntPipe) userId: number, @CurrentUser() user: AuthenticatedUser) {
    return this.candidateProfileService.getByUserId(userId, user);
  }
}
