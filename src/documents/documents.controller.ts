import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import type { Response } from 'express';
import { DocumentsService } from './documents.service.js';
import { UploadDocumentDto } from './dto/upload-document.dto.js';
import { Permissions } from '../common/decorators/permissions.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { PERMISSIONS } from '../common/constants/permissions.constants.js';
import type { AuthenticatedUser } from '../common/types/authenticated-user.js';

// Cenário obrigatório #9 do enunciado (integração externa/upload
// controlado): MIME e tamanho validados ANTES do arquivo chegar ao
// Service — currículo/carta/certificado, formatos comuns de escritório.
const ALLOWED_MIME_TYPES = new Set(['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']);
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;

const UPLOAD_DIR = join(process.cwd(), 'uploads');
if (!existsSync(UPLOAD_DIR)) {
  mkdirSync(UPLOAD_DIR, { recursive: true });
}

@Controller('documents')
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Permissions(PERMISSIONS.DOCUMENT_UPLOAD_OWN)
  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: UPLOAD_DIR,
        // Nome em disco nunca é o nome original (acidente de path
        // traversal / colisão) — UUID + extensão original só pra manter
        // o tipo de arquivo reconhecível no filesystem.
        filename: (_req, file, callback) => callback(null, `${randomUUID()}${extname(file.originalname)}`),
      }),
      limits: { fileSize: MAX_FILE_SIZE_BYTES },
      fileFilter: (_req, file, callback) => {
        if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
          callback(new BadRequestException({ statusCode: 400, error: 'Bad Request', reason: 'mime_type_invalido', message: `Tipo de arquivo não permitido: ${file.mimetype}.` }), false);
          return;
        }
        callback(null, true);
      },
    }),
  )
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
