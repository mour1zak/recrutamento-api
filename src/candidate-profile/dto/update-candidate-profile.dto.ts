import { ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class UpdateCandidateProfileDto {
  @ApiPropertyOptional({ description: 'Título curto do perfil (ex.: cargo desejado).', maxLength: 160 })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  headline?: string;

  @ApiPropertyOptional({ description: 'Resumo/apresentação do candidato.', maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  summary?: string;

  @ApiPropertyOptional({ description: 'Telefone de contato.', maxLength: 30 })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  // Opcional (diferente de Company): o candidato pode preencher o perfil
  // aos poucos, sem CEP na primeira vez. Se vier, dispara nova consulta
  // (mesmo CepService de Companies); só substitui o endereço atual se o
  // CEP resolver de verdade (rejeita com 400 se for inválido, preserva o
  // endereço anterior se o provedor estiver indisponível — ver CepService).
  @ApiPropertyOptional({ description: 'CEP — consultado via integração externa (ViaCEP) pra enriquecer o endereço. Opcional: o perfil pode ser preenchido aos poucos, sem CEP.', example: '01310-100' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{5}-?\d{3}$/, { message: 'CEP deve ter o formato 00000-000 ou 00000000.' })
  cep?: string;

  // Achado da revisão técnica (ressalva 2): só `@ArrayMaxSize` não limita o
  // tamanho de CADA item — 30 strings de 3.000 caracteres passavam
  // (`200`), e como `skills` aparece até no payload REDUZIDO (visível a
  // qualquer recrutador com candidatura `PENDING`), um candidato
  // conseguia empurrar ~90 KB pra tela de triagem de todo mundo.
  @ApiPropertyOptional({ description: 'Lista de habilidades. Máximo 30 itens, 60 caracteres cada (limite anti-abuso: esse campo aparece até no payload reduzido, visível a qualquer recrutador com candidatura pendente).', type: [String], maxItems: 30 })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  @ArrayMaxSize(30)
  skills?: string[];
}
