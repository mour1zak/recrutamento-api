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
  // (mesmo CepService de Companies); só substitui o endereço atual se o
  // CEP resolver de verdade (rejeita com 400 se for inválido, preserva o
  // endereço anterior se o provedor estiver indisponível — ver CepService).
  @IsOptional()
  @IsString()
  @Matches(/^\d{5}-?\d{3}$/, { message: 'CEP deve ter o formato 00000-000 ou 00000000.' })
  cep?: string;

  // Achado Qwen rodada 10 (ressalva 2): só `@ArrayMaxSize` não limita o
  // tamanho de CADA item — 30 strings de 3.000 caracteres passavam
  // (`200`), e como `skills` aparece até no payload REDUZIDO (visível a
  // qualquer recrutador com candidatura `PENDING`), um candidato
  // conseguia empurrar ~90 KB pra tela de triagem de todo mundo.
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  @ArrayMaxSize(30)
  skills?: string[];
}
