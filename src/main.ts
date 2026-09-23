import compression from 'compression';
import helmet from 'helmet';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.use(helmet());
  app.use(compression());

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Bônus (item obrigatório do enunciado não é — documentação viva da
  // API). Decisão registrada: `/docs` fica FORA do `ApiKeyGuard` global,
  // de propósito — o `SwaggerModule.setup()` monta a UI como middleware
  // Express puro (`app.use()`), fora do pipeline de guards do Nest, então
  // não daria pra exigir a API key sem um middleware dedicado só pra
  // isso. Tratamos a documentação como informação pública (não expõe
  // dado nenhum, só descreve o contrato), consistente com a prática comum
  // de mercado — diferente das rotas de negócio, que continuam exigindo
  // `x-api-key` sem exceção (decisão CE-1, inalterada).
  const swaggerConfig = new DocumentBuilder()
    .setTitle('Plataforma de Recrutamento — API (AV-04)')
    .setDescription(
      'API de uma plataforma de recrutamento: candidatos, empresas, vagas, ' +
        'candidaturas, entrevistas e documentos. Autenticação em duas camadas: ' +
        'a chave `x-api-key` (header, obrigatória em toda rota, sem exceção) ' +
        'identifica o cliente consumidor da API; o token JWT (`Authorization: ' +
        'Bearer <token>`) identifica o usuário autenticado. RBAC dinâmico via ' +
        'banco de dados — cada papel (CANDIDATE/RECRUITER/ADMIN, ou um papel ' +
        'custom criado em runtime) tem um conjunto de permissões que controla ' +
        'o acesso rota a rota.',
    )
    .setVersion('1.0')
    .addApiKey({ type: 'apiKey', name: 'x-api-key', in: 'header', description: 'Chave do cliente consumidor da API — obrigatória em toda rota.' }, 'api-key')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: 'Token de acesso obtido em `POST /auth/login` ou `/auth/register`.' }, 'jwt')
    .build();
  const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, swaggerDocument);

  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
