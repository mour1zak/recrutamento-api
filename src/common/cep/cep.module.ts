import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { CepService } from './cep.service.js';
import { CepController } from './cep.controller.js';

@Module({
  imports: [HttpModule],
  controllers: [CepController],
  providers: [CepService],
  exports: [CepService],
})
export class CepModule {}
