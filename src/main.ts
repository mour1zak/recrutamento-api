import compression from 'compression';
import helmet from 'helmet';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { configureCors } from './common/cors.config.js';
import { configureSwagger } from './common/swagger.config.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // `upgradeInsecureRequests` (diretiva padrão do Helmet) manda o navegador
  // reescrever toda requisição de sub-recurso da página pra HTTPS — mas
  // este projeto nunca serve HTTPS em lugar nenhum (nem aqui, nem no
  // Dockerfile). Em `localhost`/`127.0.0.1` o Chrome trata a origem como
  // "confiável" e ignora a diretiva, então passava despercebido; acessando
  // por IP de rede real (ex.: demo via VM), o navegador tenta buscar os
  // assets do Swagger via HTTPS, não existe TLS na porta, e tudo falha com
  // ERR_SSL_PROTOCOL_ERROR — página em branco, sem erro visível. Desligada
  // aqui porque não existe variante HTTPS pra "fazer upgrade" no projeto.
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          ...helmet.contentSecurityPolicy.getDefaultDirectives(),
          'upgrade-insecure-requests': null,
        },
      },
    }),
  );
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
