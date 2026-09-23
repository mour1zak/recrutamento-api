import { BadRequestException, Body, Controller, Get, Param, ParseIntPipe, Post, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { DocumentsService } from './documents.service.js';
import { UploadDocumentDto } from './dto/upload-document.dto.js';
import { Permissions } from '../common/decorators/permissions.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { PERMISSIONS } from '../common/constants/permissions.constants.js';
import type { AuthenticatedUser } from '../common/types/authenticated-user.js';

@Controller('documents')
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  // Sem opções inline aqui de propósito (achado da revisão do Docker):
  // `storage`/`limits`/`fileFilter` agora vêm do `MulterModule.registerAsync()`
  // em `documents.module.ts`, que lê `UPLOAD_DIR`/`MAX_UPLOAD_SIZE_MB` do
  // `ConfigService` — um decorator não consegue injetar dependências nos
  // argumentos que recebe, então essa config não podia morar aqui.
  @Permissions(PERMISSIONS.DOCUMENT_UPLOAD_OWN)
  @Post()
  @UseInterceptors(FileInterceptor('file'))
  async upload(@UploadedFile() file: Express.Multer.File | undefined, @Body() dto: UploadDocumentDto, @CurrentUser() user: AuthenticatedUser) {
    // `type` chega como campo de texto do multipart (multer popula
    // `req.body` antes do `ValidationPipe` rodar) — `@IsEnum` no DTO já
    // garante um valor válido antes de chegar aqui, igual a qualquer
    // outro `@Body()` da aplicação.
    if (!file) {
      throw new BadRequestException({ statusCode: 400, error: 'Bad Request', reason: 'arquivo_ausente', message: 'Nenhum arquivo enviado (campo "file").' });
    }
    return this.documentsService.create(user, dto.type, file);
  }

  @Permissions(PERMISSIONS.DOCUMENT_READ_OWN)
  @Get('me')
  findMine(@CurrentUser() user: AuthenticatedUser) {
    return this.documentsService.findMine(user);
  }

  // Sem `@Permissions()` (mesmo motivo de `ApplicationsController.findOne`):
  // `document:read:own` OU `document:read:application` — o guard só sabe
  // fazer E. A checagem de "tem pelo menos uma das duas" e a decisão de
  // escopo ficam dentro de `findScopedOrThrow()`.
  @Get(':id')
  async findOne(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AuthenticatedUser, @Res() res: Response) {
    const document = await this.documentsService.findScopedOrThrow(id, user);
    res.download(document.path, document.originalName);
  }
}
