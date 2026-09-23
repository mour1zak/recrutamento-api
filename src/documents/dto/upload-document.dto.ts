import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { DocumentType } from '../../generated/prisma/client.js';

export class UploadDocumentDto {
  @ApiProperty({ description: 'Tipo do documento enviado.', enum: DocumentType })
  @IsEnum(DocumentType)
  type!: DocumentType;
}
