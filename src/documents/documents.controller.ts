import { BadRequestException, Body, Controller, Get, Param, ParseIntPipe, Post, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiParam, ApiResponse, ApiSecurity, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { DocumentsService } from './documents.service.js';
import { UploadDocumentDto } from './dto/upload-document.dto.js';
import { Permissions } from '../common/decorators/permissions.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { PERMISSIONS } from '../common/constants/permissions.constants.js';
import { DocumentType } from '../generated/prisma/client.js';
import type { AuthenticatedUser } from '../common/types/authenticated-user.js';

@ApiTags('Documentos')
@ApiSecurity('api-key')
@ApiBearerAuth('jwt')
@Controller('documents')
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @ApiOperation({ summary: 'Enviar documento (upload)', description: 'Multipart/form-data. Tipos aceitos: PDF, DOC, DOCX. Tamanho máximo configurável via `MAX_UPLOAD_SIZE_MB` (padrão 5 MB).' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary', description: 'Arquivo PDF/DOC/DOCX.' },
        type: { type: 'string', enum: Object.values(DocumentType), description: 'Tipo do documento.' },
      },
      required: ['file', 'type'],
    },
  })
  @ApiResponse({ status: 201, description: 'Documento enviado.' })
  @ApiResponse({ status: 400, description: 'Arquivo ausente (`reason: "arquivo_ausente"`), tipo MIME não permitido, ou arquivo excede o tamanho máximo (`reason: "arquivo_excede_tamanho_maximo"`).' })
  @ApiResponse({ status: 401, description: 'API key ou JWT ausente/inválido.' })
  @ApiResponse({ status: 403, description: 'Sem a permissão `document:upload:own`.' })
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

  @ApiOperation({ summary: 'Listar os próprios documentos' })
  @ApiResponse({ status: 200, description: 'Lista de documentos do usuário autenticado.' })
  @ApiResponse({ status: 401, description: 'API key ou JWT ausente/inválido.' })
  @ApiResponse({ status: 403, description: 'Sem a permissão `document:read:own`.' })
  @Permissions(PERMISSIONS.DOCUMENT_READ_OWN)
  @Get('me')
  findMine(@CurrentUser() user: AuthenticatedUser) {
    return this.documentsService.findMine(user);
  }

  @ApiOperation({
    summary: 'Baixar documento por ID',
    description:
      'Sem `@Permissions()` (mesmo motivo de `ApplicationsController.findOne`): aceita `document:read:own` (o próprio dono) OU `document:read:application` (recrutador da vaga associada, só quando o documento está vinculado como currículo de uma candidatura). A checagem "tem pelo menos uma" fica no Service.',
  })
  @ApiParam({ name: 'id', type: Number })
  @ApiResponse({ status: 200, description: 'Arquivo binário (download direto).' })
  @ApiResponse({ status: 401, description: 'API key ou JWT ausente/inválido.' })
  @ApiResponse({ status: 403, description: 'Usuário autenticado sem nenhuma das permissões de leitura de documento.' })
  @ApiResponse({ status: 404, description: 'Documento não encontrado, ou não visível para este usuário (anti-enumeração).' })
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
