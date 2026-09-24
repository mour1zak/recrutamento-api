import compression from 'compression';
import helmet from 'helmet';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { configureCors } from './common/cors.config.js';
import { configureSwagger } from './common/swagger.config.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.use(helmet());
  app.use(compression());
  configureCors(app);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Bônus (item obrigatório do enunciado não é — documentação viva da
  // API). Decisão REVERTIDA na rodada 15 (achado crítico Qwen): `/docs`
  // tinha ficado fora do `ApiKeyGuard` global, tratada como documentação
  // pública. Isso contradizia o próprio `info.description` ("x-api-key
  // obrigatória em toda rota, sem exceção" — CE-1) e expunha o mapa
  // completo de 41 rotas/17 schemas/24 permission keys/15 `reason` codes
  // sem nenhuma credencial. `SwaggerModule.setup()` monta a UI/spec como
  // middleware Express puro, fora do pipeline de guards do Nest — por
  // isso a proteção (`configureSwagger`, `src/common/swagger.config.ts`)
  // é um middleware dedicado exigindo a mesma `x-api-key` (não JWT —
  // documentação não é ação de usuário autenticado, e exigir Bearer
  // tornaria o bootstrapping circular).
  configureSwagger(app);

  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
