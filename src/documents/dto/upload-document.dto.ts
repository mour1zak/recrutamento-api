import { IsEnum } from 'class-validator';
import { DocumentType } from '../../generated/prisma/client.js';

export class UploadDocumentDto {
  @IsEnum(DocumentType)
  type!: DocumentType;
}
