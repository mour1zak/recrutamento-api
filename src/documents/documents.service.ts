import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { errorBody } from '../common/exceptions/error-body.util.js';
import { isAdmin } from '../common/utils/role.util.js';
import { isCompanyOperable } from '../common/utils/company-scope.util.js';
import { PERMISSIONS } from '../common/constants/permissions.constants.js';
import { ApplicationStatus, DocumentType } from '../generated/prisma/client.js';
import type { AuthenticatedUser } from '../common/types/authenticated-user.js';

// Achado Fase 1, Pergunta 2 da especificação de negócio: mesma lista positiva usada em
// Application/CandidateProfile — "status de avaliação em andamento" é a
// mesma pergunta de negócio nos três lugares.
const STATUSES_THAT_GRANT_DOCUMENT_ACCESS: ApplicationStatus[] = [
  ApplicationStatus.UNDER_REVIEW,
  ApplicationStatus.INTERVIEW,
  ApplicationStatus.OFFERED,
  ApplicationStatus.HIRED,
];

function documentNotFound() {
  return new NotFoundException(errorBody(404, 'document_not_found', 'Documento não encontrado.'));
}

@Injectable()
export class DocumentsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(currentUser: AuthenticatedUser, type: DocumentType, file: { filename: string; originalname: string; mimetype: string; size: number; path: string }) {
    return this.prisma.document.create({
      data: {
        ownerId: currentUser.id,
        type,
        filename: file.filename,
        originalName: file.originalname,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        path: file.path,
      },
      select: { id: true, filename: true, mimeType: true, sizeBytes: true },
    });
  }

  async findMine(currentUser: AuthenticatedUser) {
    return this.prisma.document.findMany({
      where: { ownerId: currentUser.id },
      select: { id: true, type: true, filename: true, originalName: true, mimeType: true, sizeBytes: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  // Devolve o registro (com `path` em disco) só depois de confirmar
  // escopo — o Controller decide como servir o arquivo (stream), este
  // Service só decide SE pode.
  async findScopedOrThrow(id: number, currentUser: AuthenticatedUser) {
    // Sem `@Permissions()` no controller (o guard só faz E, esta rota
    // precisa de OU entre `document:read:own` e `document:read:application`
    // — mesmo padrão de `ApplicationsService.findOne`).
    const hasAnyReadPermission =
      currentUser.permissions.includes(PERMISSIONS.DOCUMENT_READ_OWN) || currentUser.permissions.includes(PERMISSIONS.DOCUMENT_READ_APPLICATION);
    if (!hasAnyReadPermission) {
      throw new ForbiddenException(errorBody(403, 'permission_denied', 'Você não tem permissão para executar esta ação.'));
    }

    // `omit: { path: false }`: override pontual do `omit` global do
    // PrismaService (mesmo padrão de `findByEmailForLogin` em
    // users.service.ts) — `path` é omitido por padrão em qualquer
    // resposta da API (não é informação pra vazar), mas aqui é exatamente
    // o campo que o Controller precisa pra servir o arquivo (nunca sai
    // deste método pro cliente, só o Controller usa pra `res.download()`).
    const document = await this.prisma.document.findUnique({ where: { id }, omit: { path: false } });
    if (!document) {
      throw documentNotFound();
    }
    if (document.ownerId === currentUser.id || isAdmin(currentUser)) {
      return document;
    }
    // Achado CRÍTICO da revisão técnica (K5): faltava `isCompanyOperable()` —
    // sem ela, um recrutador de empresa desativada continuava baixando
    // arquivos normalmente.
    const companyId = currentUser.companyId;
    if (companyId === null || !(await isCompanyOperable(this.prisma, companyId))) {
      throw documentNotFound();
    }
    // `document:read:application`: só se este documento específico foi
    // ANEXADO (`resumeDocumentId`) a uma candidatura da empresa do
    // recrutador, com status que já indica avaliação em andamento.
    // Achado CRÍTICO da revisão técnica (K6): a versão anterior também
    // aceitava `{ candidateId: document.ownerId }` — bastava existir
    // QUALQUER candidatura qualificada do candidato na empresa pra
    // liberar TODOS os documentos dele, mesmo os nunca anexados a
    // candidatura nenhuma (medido com um documento pessoal/sensível
    // nunca anexado, liberado do mesmo jeito). Removida — só o vínculo
    // explícito de anexo conta.
    const linkedApplication = await this.prisma.application.findFirst({
      where: {
        resumeDocumentId: id,
        job: { companyId },
        status: { in: STATUSES_THAT_GRANT_DOCUMENT_ACCESS },
      },
      select: { id: true },
    });
    if (!linkedApplication) {
      throw documentNotFound();
    }
    return document;
  }
}
