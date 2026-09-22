import { Module } from '@nestjs/common';
import { ApplicationsService } from './applications.service.js';
import { ApplicationsController } from './applications.controller.js';

@Module({
  controllers: [ApplicationsController],
  providers: [ApplicationsService],
  exports: [ApplicationsService],
})
export class ApplicationsModule {}
