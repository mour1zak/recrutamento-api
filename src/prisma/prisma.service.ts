import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    const adapter = new PrismaPg({
      connectionString: process.env.DATABASE_URL!,
    });

    // `omit` global (mitigação obrigatória de C3, achado Qwen rodada 2/3):
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
