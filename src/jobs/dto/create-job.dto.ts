import { IsBoolean, IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class CreateJobDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  title!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  description!: string;

  @IsInt()
  @Min(1)
  vacancies!: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  salaryMin?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100_000_000)
  salaryMax?: number;

  @IsBoolean()
  isRemote!: boolean;

  // Só ADMIN usa este campo (obrigatório pra eles, já que não têm
  // companyId próprio) — RECRUITER tem a vaga atrelada à própria empresa
  // automaticamente; se um RECRUITER mandar um valor diferente do seu,
  // vira 404 (CompaniesService/JobsService.assertScopeOrThrow), não 400,
  // pra não confirmar/negar a existência da empresa de terceiro.
  @IsOptional()
  @IsInt()
  companyId?: number;
}
