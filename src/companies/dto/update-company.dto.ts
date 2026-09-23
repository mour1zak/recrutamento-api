import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class UpdateCompanyDto {
  @ApiPropertyOptional({ description: 'Novo nome/razão social.', maxLength: 160 })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  name?: string;

  @ApiPropertyOptional({ description: 'Novo CNPJ, com ou sem máscara.' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{14}$|^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/, { message: 'CNPJ deve ter 14 dígitos (com ou sem máscara).' })
  cnpj?: string;

  @ApiPropertyOptional({ description: 'Nova descrição.', maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  // Diferente do create: aqui é opcional mesmo (PATCH parcial). Se vier,
  // dispara nova consulta e substitui o endereço atual.
  @ApiPropertyOptional({ description: 'Novo CEP. Se o provedor confirmar que não existe, a atualização inteira é rejeitada (`400`) — não só o CEP. Se o provedor estiver indisponível (falha de rede), o endereço anterior é preservado (nunca apagado por instabilidade externa).', example: '01310-100' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{5}-?\d{3}$/, { message: 'CEP deve ter o formato 00000-000 ou 00000000.' })
  cep?: string;
}
