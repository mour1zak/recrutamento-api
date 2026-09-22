import { IsInt, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateApplicationDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  coverLetter?: string;

  // Validado no Service (não só pela FK): o documento precisa pertencer
  // a quem está se candidatando (`resumeDocument.ownerId === candidateId`,
  // pendência registrada em CONDICOES-ENTRADA-FASE2.md desde a Fase 1 —
  // não é enforçável só por constraint de banco).
  @IsOptional()
  @IsInt()
  resumeDocumentId?: number;
}
