import type { PrismaService } from '../../prisma/prisma.service.js';

// Achado da revisão técnica (resposta à pergunta 3 do pacote CandidateProfile):
// a checagem "esta empresa existe e está ativa?" estava duplicada entre
// `JobsService` e `CandidateProfileService`, mas com `reason`s de 404
// DIFERENTES de propósito (anti-enumeração) — um helper que também
// lançasse o erro vazaria qual dos dois motivos aconteceu. Por isso só o
// PREDICADO é compartilhado; cada módulo decide sozinho qual 404 lançar.
// `Application` é o terceiro consumidor da mesma pergunta — o gatilho que
// a própria revisão técnica recomendou para extrair.
export async function isCompanyOperable(prisma: PrismaService, companyId: number | null): Promise<boolean> {
  if (companyId === null) {
    return false;
  }
  const company = await prisma.company.findUnique({ where: { id: companyId }, select: { isActive: true } });
  return company?.isActive ?? false;
}
