import { ArgumentsHost, Catch, HttpStatus, UnauthorizedException } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import type { Response } from 'express';
import { Prisma } from '../../generated/prisma/client.js';
import { STATUS_TEXT } from '../exceptions/error-body.util.js';

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

// `reason` machine-readable, só para constraints de módulos criados a
// partir da decisão de adotar {statusCode, reason, message} (Companies em
// diante — ver src/common/exceptions/error-body.util.ts). As constraints
// do Auth (já auditado) ficam de fora de propósito, pra não mudar um
// formato de resposta já fechado.
const CONSTRAINT_REASONS: Record<string, string> = {
  Company_cnpj_key: 'cnpj_duplicado',
  // Achado Qwen rodada 10 (P4): rede de segurança pro `P2002` de
  // `CandidateProfile.userId` — o caminho normal (`upsertMine()`) já
  // trata a corrida de `upsert` retentando como `update`, mas se esse
  // retry também colidir (extremamente improvável), o erro que escapa
  // até aqui agora tem `reason`, em vez de ser o único 409 de domínio
  // sem um.
  CandidateProfile_userId_key: 'candidate_profile_conflict',
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

// Achado Qwen rodada 7 (ressalvas 2 e 3): erros de integridade que passam
// por SQL cru (`$executeRawUnsafe`/`$queryRaw`) chegam como `P2010`
// (envelope genérico de "raw query failed"), e uma violação de `CHECK` via
// client chega como `P2039` — nenhum dos dois tem um `case` dedicado no
// switch abaixo, então caíam no `default` e viravam `500`. O SQLSTATE real
// (classe do padrão SQL, não específico do Prisma) sempre está em
// `meta.driverAdapterError.cause.originalCode`, então mapear por ele cobre
// qualquer P-code que o encapsule, não só os dois medidos. Também inclui
// os retryáveis que uma fila de `SELECT ... FOR UPDATE` (Fase 3) pode
// produzir (deadlock, lock indisponível, timeout de statement) — sinalizados
// por Qwen como risco não medido, mas do mesmo jeito, cobertos por
// precaução.
const SQLSTATE_CONFLICT = new Set([
  '23505', // unique_violation
  '23514', // check_violation (ex.: `CHECK (filledCount <= vacancies)` da Fase 3)
  '40001', // serialization_failure (mesmo código do duck-typing acima, coberto aqui também por completude)
  '40P01', // deadlock_detected
  '55P03', // lock_not_available
  '57014', // query_canceled (statement_timeout)
]);
const SQLSTATE_BAD_REQUEST = new Set([
  '23503', // foreign_key_violation
  '23502', // not_null_violation
]);

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
      const { status, message, reason } = this.mapPrismaError(exception);
      this.respond(host, status, message, reason);
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

  private respond(host: ArgumentsHost, status: number, message: string, reason?: string) {
    const response = host.switchToHttp().getResponse<Response>();
    const body: Record<string, unknown> = { statusCode: status, error: STATUS_TEXT[status] ?? 'Error', message };
    if (reason) {
      body.reason = reason;
    }
    response.status(status).json(body);
  }

  private mapPrismaError(exception: Prisma.PrismaClientKnownRequestError): { status: number; message: string; reason?: string } {
    // Erro de infraestrutura (banco inacessível, servidor fechou a conexão,
    // timeout do pool) não é conflito de dado — retryar contra um banco
    // fora do ar é o comportamento errado que um 409 induziria.
    if (exception.code.startsWith('P1')) {
      return { status: HttpStatus.SERVICE_UNAVAILABLE, message: 'Serviço temporariamente indisponível.' };
    }

    switch (exception.code) {
      case 'P2002': {
        const field = this.constraintLabel(exception) ?? 'valor único';
        const index = this.constraintIndex(exception);
        return {
          status: HttpStatus.CONFLICT,
          message: `Já existe um registro com o mesmo valor em: ${field}.`,
          reason: index ? CONSTRAINT_REASONS[index] : undefined,
        };
      }
      case 'P2025': {
        const meta = exception.meta as { modelName?: string } | undefined;
        const label = (meta?.modelName && MODEL_LABELS[meta.modelName]) || 'Recurso';
        return { status: HttpStatus.NOT_FOUND, message: `${label} não encontrado.` };
      }
      case 'P2003':
        return { status: HttpStatus.BAD_REQUEST, message: 'Referência a um recurso relacionado inexistente.' };
      case 'P2020':
        return { status: HttpStatus.BAD_REQUEST, message: 'Valor fora do intervalo permitido para o campo.' };
      case 'P2034':
      case 'P2028':
        // Mantido por completude (ver comentário de isTransactionWriteConflict) —
        // não é o caminho real hoje, mas custa nada deixar coberto.
        return { status: HttpStatus.CONFLICT, message: 'Conflito de concorrência — tente novamente.' };
      default: {
        // P2010 (SQL cru) e qualquer outro código não mapeado acima podem
        // ainda assim ser um erro de integridade/concorrência real — ver
        // comentário de SQLSTATE_CONFLICT/SQLSTATE_BAD_REQUEST acima.
        const state = this.sqlState(exception);
        if (state && SQLSTATE_CONFLICT.has(state)) {
          return { status: HttpStatus.CONFLICT, message: 'Conflito de concorrência ou de regra de negócio — tente novamente.' };
        }
        if (state && SQLSTATE_BAD_REQUEST.has(state)) {
          return { status: HttpStatus.BAD_REQUEST, message: 'Referência ou valor inválido para um campo relacionado.' };
        }
        return { status: HttpStatus.INTERNAL_SERVER_ERROR, message: 'Erro interno ao processar a operação.' };
      }
    }
  }

  private sqlState(exception: Prisma.PrismaClientKnownRequestError): string | undefined {
    const meta = exception.meta as { driverAdapterError?: { cause?: { originalCode?: string } } } | undefined;
    return meta?.driverAdapterError?.cause?.originalCode;
  }

  private constraintIndex(exception: Prisma.PrismaClientKnownRequestError): string | undefined {
    const meta = exception.meta as { driverAdapterError?: { cause?: { constraint?: { index?: string } } } } | undefined;
    return meta?.driverAdapterError?.cause?.constraint?.index;
  }

  private constraintLabel(exception: Prisma.PrismaClientKnownRequestError): string | undefined {
    const index = this.constraintIndex(exception);
    return index ? CONSTRAINT_LABELS[index] : undefined;
  }
}
