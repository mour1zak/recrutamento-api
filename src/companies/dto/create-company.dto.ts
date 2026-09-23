import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class CreateCompanyDto {
  @ApiProperty({ description: 'Razão social ou nome fantasia da empresa.', example: 'Tech Solutions Ltda', maxLength: 160 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  name!: string;

  // Só dígitos, com ou sem máscara — normalizado antes de persistir
  // (ver CompaniesService.normalizeCnpj). 14 dígitos é o tamanho de um
  // CNPJ real; a checagem de dígito verificador fica fora do escopo (a
  // unicidade que a regra de negócio exige já é garantida pelo banco).
  @ApiPropertyOptional({ description: 'CNPJ, com ou sem máscara — único no sistema. Normalizado (só dígitos) antes de salvar.', example: '12.345.678/0001-90' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{14}$|^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/, { message: 'CNPJ deve ter 14 dígitos (com ou sem máscara).' })
  cnpj?: string;

  @ApiPropertyOptional({ description: 'Descrição livre da empresa.', maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  // Obrigatório no DTO (dispara a consulta externa), mas o campo persistido
  // é opcional no schema. Achado #9 do enunciado (integração externa
  // falhando de forma controlada): uma falha de REDE não bloqueia a
  // criação (empresa criada sem endereço enriquecido); um CEP que o
  // provedor confirma não existir bloqueia com 400 (achado Qwen rodada
  // 11, N1 — ver CepService).
  @ApiProperty({ description: 'CEP — consultado via integração externa (ViaCEP) pra enriquecer o endereço. Se o provedor confirmar que o CEP não existe, a criação é rejeitada (`400`); só falha de rede/timeout não bloqueia.', example: '01310-100' })
  @IsString()
  @Matches(/^\d{5}-?\d{3}$/, { message: 'CEP deve ter o formato 00000-000 ou 00000000.' })
  cep!: string;
}
