import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsOptional } from 'class-validator';

export class UpdateUserCompanyDto {
  // `null` desvincula o RECRUITER de qualquer empresa — `@IsOptional()`
  // no class-validator trata `null` e `undefined` da mesma forma
  // (pula a validação seguinte), o que deixa os dois passarem; o Service
  // é quem decide se `null` é aceitável pra este usuário.
  @ApiProperty({ description: 'ID da empresa a vincular (só para usuários RECRUITER), ou `null` para desvincular. Campo obrigatório no corpo — omiti-lo é erro (`400 company_id_obrigatorio`), diferente de enviar `null`.', type: Number, nullable: true, example: 3 })
  @IsOptional()
  @IsInt()
  companyId!: number | null;
}
