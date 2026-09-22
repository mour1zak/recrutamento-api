import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { PassportModule } from '@nestjs/passport';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { AuthModule } from './auth/auth.module.js';
import { UsersModule } from './users/users.module.js';
import { CompaniesModule } from './companies/companies.module.js';
import { JobsModule } from './jobs/jobs.module.js';
import { CandidateProfileModule } from './candidate-profile/candidate-profile.module.js';
import { ApiKeyGuard } from './common/guards/api-key.guard.js';
import { PermissionsGuard } from './common/guards/permissions.guard.js';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard.js';
import { envValidationSchema } from './config/env.validation.js';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: process.env.NODE_ENV === 'test' ? '.env.test' : '.env',
      // Falha o boot se alguém subir com os placeholders do .env.example
      // (achado crítico Qwen rodada 4, C1 — bypass total de autenticação
      // com o segredo público documentado no repositório).
      validationSchema: envValidationSchema,
    }),
    // Precisa estar aqui (não só dentro de AuthModule): o JwtAuthGuard é
    // registrado como APP_GUARD abaixo, e guards globais são instanciados
    // no injector do módulo onde aparecem no array de `providers`.
    PassportModule.register({ defaultStrategy: 'jwt' }),
    PrismaModule,
    UsersModule,
    AuthModule,
    CompaniesModule,
    JobsModule,
    CandidateProfileModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Ordem importa e é a correção do achado crítico C2 (rodada 4): guards
    // globais (APP_GUARD) rodam nesta ordem, antes de qualquer guard de
    // controller/rota. ApiKeyGuard (cliente conhecido) → JwtAuthGuard
    // (quem é o usuário, isento via @Public()) → PermissionsGuard (o papel
    // tem a permission key). Antes desta correção, PermissionsGuard era
    // global mas JwtAuthGuard só existia por controller — rodava depois,
    // e toda rota com @Permissions() dava 403 mesmo para quem tinha a
    // permissão.
    { provide: APP_GUARD, useClass: ApiKeyGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    // Filtro único (rodada 6, achado N1-d/ressalva 7): unifica o que antes
    // eram dois APP_FILTER separados, para eliminar qualquer ambiguidade
    // sobre qual filtro o Nest escolhe primeiro entre múltiplos globais.
    // Trata Prisma, conflito de transação (Serializable) e 401 — delega o
    // resto pro comportamento padrão do Nest via `super.catch()`.
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
  ],
})
export class AppModule {}
