import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    // Gate Fase 3 (achado da revisão técnica, N15): sem limites explícitos, um
    // teste de concorrência com N requisições simultâneas esbarra no
    // limite PADRÃO do pool do `pg` antes de esbarrar no lock/`CHECK` que
    // a Fase 3 testa — o sintoma vira um timeout confuso (`P2028`) em vez
    // da contenção esperada (`409`). Valores conservadores para uma API
    // de avaliação (não produção de alto tráfego): `max` cobre os testes
    // de concorrência já escritos (até 12 requisições simultâneas nos
    // testes de K1/K2/K3) sem esgotar o pool antes do lock.
    const adapter = new PrismaPg({
      connectionString: process.env.DATABASE_URL!,
      max: 20,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 30000,
    });

    // `omit` global (mitigação obrigatória de C3, achado da revisão técnica):
    // campos sensíveis nunca saem por padrão, mesmo se algum endpoint
    // esquecer de usar `select`. Só cobre o Prisma Client — `$queryRaw`
    // ignora `omit`, então SQL bruto (Fase 3) precisa selecionar só as
    // colunas estritamente necessárias.
    super({
      adapter,
      omit: {
        user: { password: true },
        refreshToken: { tokenHash: true },
        document: { path: true },
      },
    });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
