import { ArrayMaxSize, IsArray, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class UpdateCandidateProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(160)
  headline?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  summary?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  // Opcional (diferente de Company): o candidato pode preencher o perfil
  // aos poucos, sem CEP na primeira vez. Se vier, dispara nova consulta
  // (mesmo CepService de Companies) e substitui o endereço atual.
  @IsOptional()
  @IsString()
  @Matches(/^\d{5}-?\d{3}$/, { message: 'CEP deve ter o formato 00000-000 ou 00000000.' })
  cep?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(30)
  skills?: string[];
}
