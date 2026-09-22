import { IsInt, IsOptional } from 'class-validator';

export class UpdateUserCompanyDto {
  // `null` desvincula o RECRUITER de qualquer empresa — `@IsOptional()`
  // no class-validator trata `null` e `undefined` da mesma forma
  // (pula a validação seguinte), o que deixa os dois passarem; o Service
  // é quem decide se `null` é aceitável pra este usuário.
  @IsOptional()
  @IsInt()
  companyId!: number | null;
}
