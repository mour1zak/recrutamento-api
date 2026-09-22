import { Module } from '@nestjs/common';
import { InterviewsService } from './interviews.service.js';
import { InterviewsController } from './interviews.controller.js';

@Module({
  controllers: [InterviewsController],
  providers: [InterviewsService],
  exports: [InterviewsService],
})
export class InterviewsModule {}
