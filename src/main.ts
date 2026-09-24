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
  // API). `/docs`/`/docs-json` ficam fora do `ApiKeyGuard` global e são
  // públicos por decisão consciente (não um descuido): a alternativa com
  // `x-api-key`/Basic Auth funcionava, mas a UX do popup nativo de login
  // pra uma chave sem conceito de usuário ficou confusa demais pra valer
  // a pena. O que protege de verdade essa decisão é que nenhum `example`
  // do Swagger publica uma credencial real do seed. Histórico completo
  // da decisão em `src/common/swagger.config.ts` e
  // `docs/fases/TRIAGEM-REVISOES-RODADA15.md`.
  configureSwagger(app);

  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
