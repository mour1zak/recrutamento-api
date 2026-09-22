import { Module } from '@nestjs/common';
import { CandidateProfileService } from './candidate-profile.service.js';
import { CandidateProfileController } from './candidate-profile.controller.js';
import { CepModule } from '../common/cep/cep.module.js';

@Module({
  imports: [CepModule],
  controllers: [CandidateProfileController],
  providers: [CandidateProfileService],
  exports: [CandidateProfileService],
})
export class CandidateProfileModule {}
