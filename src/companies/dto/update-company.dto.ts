import { IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class UpdateCompanyDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  name?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{14}$|^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/, { message: 'CNPJ deve ter 14 dígitos (com ou sem máscara).' })
  cnpj?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  // Diferente do create: aqui é opcional mesmo (PATCH parcial). Se vier,
  // dispara nova consulta e substitui o endereço atual.
  @IsOptional()
  @IsString()
  @Matches(/^\d{5}-?\d{3}$/, { message: 'CEP deve ter o formato 00000-000 ou 00000000.' })
  cep?: string;
}
