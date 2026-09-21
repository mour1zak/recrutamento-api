import { ArgumentsHost, Catch, HttpStatus, UnauthorizedException } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import type { Response } from 'express';
import { Prisma } from '../../generated/prisma/client.js';

const STATUS_TEXT: Record<number, string> = {
  [HttpStatus.BAD_REQUEST]: 'Bad Request',
  [HttpStatus.UNAUTHORIZED]: 'Unauthorized',
  [HttpStatus.NOT_FOUND]: 'Not Found',
  [HttpStatus.CONFLICT]: 'Conflict',
  [HttpStatus.SERVICE_UNAVAILABLE]: 'Service Unavailable',
  [HttpStatus.INTERNAL_SERVER_ERROR]: 'Internal Server Error',
};

// Nome real da constraint (ver migration.sql) -> rótulo amigável. Nunca
// devolver o nome cru do índice pro cliente — isso divulga estrutura
// interna do banco (achado Qwen rodada 5, N2). Verificado 10/10 exato
// contra o migration.sql na rodada 6.
const CONSTRAINT_LABELS: Record<string, string> = {
  User_email_key: 'email',
  app_roles_name_key: 'nome do papel',
  app_permissions_key_key: 'chave de permissão',
  app_role_permissions_roleId_permissionId_key: 'permissão já concedida a este papel',
  RefreshToken_tokenHash_key: 'token de sessão',
  CandidateProfile_userId_key: 'perfil de candidato',
  Company_cnpj_key: 'CNPJ',
  Application_candidateId_jobId_key: 'candidatura para esta vaga',
  Interview_previousInterviewId_key: 'entrevista anterior',
  Document_path_key: 'arquivo',
};

// Achado Qwen rodada 6 (ressalva 11): mesma ideia do CONSTRAINT_LABELS,
// aplicada ao P2025 — "recurso não encontrado" vira "usuário não
// encontrado" quando dá pra saber o modelo.
const MODEL_LABELS: Record<string, string> = {
  User: 'Usuário',
  Role: 'Papel',
  Permission: 'Permissão',
  RolePermission: 'Permissão do papel',
  RefreshToken: 'Sessão',
  CandidateProfile: 'Perfil de candidato',
  Company: 'Empresa',
  Job: 'Vaga',
  Application: 'Candidatura',
  ApplicationStatusHistory: 'Histórico de status',
  Interview: 'Entrevista',
  Document: 'Documento',
};

function isTransactionWriteConflict(error: unknown): boolean {
  // Achado crítico Qwen rodada 6 (N1-a): com driver adapter (obrigatório no
  // Prisma 7), um conflito de serialização (`Serializable`) NÃO chega como
  // `Prisma.PrismaClientKnownRequestError` com `code: 'P2034'` — chega como
  // um `DriverAdapterError` (classe nem exportada por `Prisma.*`), com
  // `cause.kind === 'TransactionWriteConflict'` / `cause.originalCode ===
  // '40001'` (o SQLSTATE de `serialization_failure` do Postgres). O
  // `case 'P2034'` do mapeamento abaixo é código morto neste stack — fica
  // mantido só para o dia em que Prisma passar a normalizar isso (ou para
  // um caminho sem driver adapter). Captura por duck-typing porque não há
  // classe pública pra usar em `instanceof`.
  const e = error as { cause?: { kind?: string; originalCode?: string } } | null | undefined;
  return e?.cause?.kind === 'TransactionWriteConflict' || e?.cause?.originalCode === '40001';
}

/**
 * Filtro global único (substitui `PrismaExceptionFilter` +
 * `UnauthorizedExceptionFilter`, unificados na rodada 6 para eliminar
 * ambiguidade de ordem entre múltiplos `APP_FILTER`): trata os casos
 * conhecidos (Prisma, conflito de transação, 401) e delega tudo o mais
 * para o comportamento padrão do Nest via `super.catch()` — nunca
 * reimplementa a serialização de `HttpException` comuns (as que os
 * próprios Services já lançam), só intercepta o que precisa de tradução.
 */
@Catch()
export class GlobalExceptionFilter extends BaseExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    if (isTransactionWriteConflict(exception)) {
      this.respond(host, HttpStatus.CONFLICT, 'Conflito de concorrência — tente novamente.');
      return;
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      const { status, message } = this.mapPrismaError(exception);
      this.respond(host, status, message);
      return;
    }

    if (exception instanceof UnauthorizedException) {
      // Achado Qwen rodada 6 (ressalva 7): erros lançados pelo Passport
      // (sem JWT, JWT malformado) têm um formato de corpo diferente dos
      // que nós lançamos manualmente (`ApiKeyGuard`, `AuthService`) — um
      // tinha `error`, o outro não. Normaliza os dois pro mesmo formato.
      const raw = exception.getResponse();
      const message = typeof raw === 'string' ? raw : ((raw as { message?: string }).message ?? 'Unauthorized');
      const response = host.switchToHttp().getResponse<Response>();
      response.setHeader('WWW-Authenticate', 'Bearer');
      this.respond(host, HttpStatus.UNAUTHORIZED, message);
      return;
    }

    // Qualquer outra coisa (HttpException normais lançadas pelos nossos
    // Services, erros de validação do ValidationPipe, erro realmente
    // desconhecido) segue o comportamento padrão do Nest.
    super.catch(exception, host);
  }

  private respond(host: ArgumentsHost, status: number, message: string) {
    const response = host.switchToHttp().getResponse<Response>();
    response.status(status).json({ statusCode: status, error: STATUS_TEXT[status] ?? 'Error', message });
  }

  private mapPrismaError(exception: Prisma.PrismaClientKnownRequestError): { status: number; message: string } {
    // Erro de infraestrutura (banco inacessível, servidor fechou a conexão,
    // timeout do pool) não é conflito de dado — retryar contra um banco
    // fora do ar é o comportamento errado que um 409 induziria.
    if (exception.code.startsWith('P1')) {
      return { status: HttpStatus.SERVICE_UNAVAILABLE, message: 'Serviço temporariamente indisponível.' };
    }

    switch (exception.code) {
      case 'P2002': {
        const field = this.constraintLabel(exception) ?? 'valor único';
        return {
          status: HttpStatus.CONFLICT,
          message: `Já existe um registro com o mesmo valor em: ${field}.`,
        };
      }
      case 'P2025': {
        const meta = exception.meta as { modelName?: string } | undefined;
        const label = (meta?.modelName && MODEL_LABELS[meta.modelName]) || 'Recurso';
        return { status: HttpStatus.NOT_FOUND, message: `${label} não encontrado.` };
      }
      case 'P2003':
        return { status: HttpStatus.BAD_REQUEST, message: 'Referência a um recurso relacionado inexistente.' };
      case 'P2034':
      case 'P2028':
        // Mantido por completude (ver comentário de isTransactionWriteConflict) —
        // não é o caminho real hoje, mas custa nada deixar coberto.
        return { status: HttpStatus.CONFLICT, message: 'Conflito de concorrência — tente novamente.' };
      default:
        return { status: HttpStatus.INTERNAL_SERVER_ERROR, message: 'Erro interno ao processar a operação.' };
    }
  }

  private constraintLabel(exception: Prisma.PrismaClientKnownRequestError): string | undefined {
    const meta = exception.meta as
      | { driverAdapterError?: { cause?: { constraint?: { index?: string } } }; modelName?: string }
      | undefined;
    const index = meta?.driverAdapterError?.cause?.constraint?.index;
    if (index && CONSTRAINT_LABELS[index]) {
      return CONSTRAINT_LABELS[index];
    }
    return undefined;
  }
}
