import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { CepService } from './cep.service.js';

@Module({
  imports: [HttpModule],
  providers: [CepService],
  exports: [CepService],
})
export class CepModule {}
