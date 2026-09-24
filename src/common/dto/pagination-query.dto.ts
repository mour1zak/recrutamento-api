import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

export type SortOrder = 'asc' | 'desc';

// Padronizado a partir de Jobs (sugestão registrada no mapa de endpoints
// §11.3: "padronizar ?page&limit em todas as listagens desde já") — todo
// endpoint de listagem estende esta classe em vez de repetir os mesmos
// campos.
export class PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Número da página (começa em 1).', minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ description: 'Quantidade de itens por página.', minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  // Achado da auditoria final: bônus de ordenação estava fixo
  // (`createdAt desc`/`id asc`, hardcoded no service), não configurável
  // pelo cliente. Em vez de aceitar um nome de campo arbitrário (risco:
  // qualquer coluna do banco viraria ordenável por query string, inclusive
  // uma que não devesse), só a DIREÇÃO é exposta aqui — cada service
  // continua decidindo o campo (o mesmo já usado como default), e usa
  // `query.sortOrder` só se vier informado, preservando o comportamento
  // atual (já coberto por teste) quando o cliente não pede nada.
  @ApiPropertyOptional({ description: 'Direção da ordenação (o campo é fixo por listagem — `createdAt` na maioria, `id` em `GET /users`). Omitido, mantém o padrão atual de cada rota.', enum: ['asc', 'desc'] })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: SortOrder;
}
