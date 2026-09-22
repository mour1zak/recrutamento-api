import { IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class CreateCompanyDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  name!: string;

  // Só dígitos, com ou sem máscara — normalizado antes de persistir
  // (ver CompaniesService.normalizeCnpj). 14 dígitos é o tamanho de um
  // CNPJ real; a checagem de dígito verificador fica fora do escopo (a
  // unicidade que a regra de negócio exige já é garantida pelo banco).
  @IsOptional()
  @IsString()
  @Matches(/^\d{14}$|^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/, { message: 'CNPJ deve ter 14 dígitos (com ou sem máscara).' })
  cnpj?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  // Obrigatório no DTO (dispara a consulta externa), mas o campo persistido
  // é opcional no schema — se a consulta falhar, a empresa ainda é criada,
  // só sem endereço enriquecido (achado #9 do enunciado: integração
  // externa falhando de forma controlada, nunca bloqueando a operação).
  @IsString()
  @Matches(/^\d{5}-?\d{3}$/, { message: 'CEP deve ter o formato 00000-000 ou 00000000.' })
  cep!: string;
}
