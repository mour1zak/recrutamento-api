import { Catch, HttpStatus, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';
import { Prisma } from '../../generated/prisma/client.js';

const STATUS_TEXT: Record<number, string> = {
  [HttpStatus.BAD_REQUEST]: 'Bad Request',
  [HttpStatus.NOT_FOUND]: 'Not Found',
  [HttpStatus.CONFLICT]: 'Conflict',
  [HttpStatus.SERVICE_UNAVAILABLE]: 'Service Unavailable',
  [HttpStatus.INTERNAL_SERVER_ERROR]: 'Internal Server Error',
};

// Nome real da constraint (ver migration.sql) -> rótulo amigável. Nunca
// devolver o nome cru do índice pro cliente — isso divulga estrutura
// interna do banco (achado Qwen rodada 5, N2).
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

/**
 * Corrige achado Qwen rodada 4 (R1): sem filtro global, um erro do Prisma
 * (unique violado, FK apontando pra registro inexistente, conflito de
 * transação) virava `500` cru — exatamente a lição nº 5 da avaliação
 * anterior ("erro de negócio virando 500 em vez de 400/404/409").
 * Alcançável hoje mesmo sem concorrência real: dois `POST /auth/register`
 * com o mesmo email em paralelo, ou `roleId` inexistente se o seed não
 * rodou.
 *
 * Rodada 5 corrigiu dois problemas encontrados por execução real (N2, N3):
 * a mensagem do 409 nunca nomeava o campo (o `meta.target` que o código
 * esperava não existe no Prisma 7 com driver adapter — o nome da
 * constraint vive em `meta.driverAdapterError.cause.constraint.index`), e
 * qualquer código não listado (inclusive erro de infraestrutura como banco
 * fora do ar) caía no `default` como `409`, fazendo o cliente pensar que
 * ele causou um conflito e tentar de novo — contra um banco que não vai
 * responder.
 */
@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaExceptionFilter implements ExceptionFilter {
  catch(exception: Prisma.PrismaClientKnownRequestError, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    const { status, message } = this.mapError(exception);

    response.status(status).json({
      statusCode: status,
      error: STATUS_TEXT[status] ?? 'Error',
      message,
    });
  }

  private mapError(exception: Prisma.PrismaClientKnownRequestError): { status: number; message: string } {
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
      case 'P2025':
        return { status: HttpStatus.NOT_FOUND, message: 'Recurso não encontrado.' };
      case 'P2003':
        return { status: HttpStatus.BAD_REQUEST, message: 'Referência a um recurso relacionado inexistente.' };
      case 'P2034':
      case 'P2028':
        return { status: HttpStatus.CONFLICT, message: 'Conflito de concorrência — tente novamente.' };
      default:
        // Código não mapeado é uma falha real não prevista — 500 honesto,
        // não um 409 que sugere "foi você quem causou isso".
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
