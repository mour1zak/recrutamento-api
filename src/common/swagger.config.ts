import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { createDocsAuthMiddleware } from './middleware/docs-auth.middleware.js';

/**
 * Extraído de `main.ts` (achado Qwen rodada 15) pra ter UM lugar só que
 * monta `/docs`/`/docs-json` — testes e2e precisam registrar exatamente a
 * mesma proteção que a aplicação real usa, e importar `main.ts` direto
 * disparava `bootstrap()` (efeito colateral de `app.listen()`) só por
 * importar o módulo. `test/docs.e2e-spec.ts` chama esta função depois de
 * criar a app de teste, sem esse efeito colateral.
 */
export function configureSwagger(app: INestApplication): void {
  const configService = app.get(ConfigService);
  const docsAuth = createDocsAuthMiddleware(configService);
  app.use('/docs', docsAuth);
  app.use('/docs-json', docsAuth);

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Plataforma de Recrutamento — API (AV-04)')
    .setDescription(
      'API de uma plataforma de recrutamento: candidatos, empresas, vagas, ' +
        'candidaturas, entrevistas e documentos. Autenticação em duas camadas: ' +
        'a chave `x-api-key` (header, obrigatória em toda rota, sem exceção — ' +
        'inclusive nesta documentação) identifica o cliente consumidor da API; ' +
        'o token JWT (`Authorization: Bearer <token>`) identifica o usuário ' +
        'autenticado. RBAC dinâmico via banco de dados — cada papel ' +
        '(CANDIDATE/RECRUITER/ADMIN, ou um papel custom criado em runtime) tem ' +
        'um conjunto de permissões que controla o acesso rota a rota.',
    )
    .setVersion('1.0')
    .addApiKey({ type: 'apiKey', name: 'x-api-key', in: 'header', description: 'Chave do cliente consumidor da API — obrigatória em toda rota, inclusive para acessar esta documentação.' }, 'api-key')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: 'Token de acesso obtido em `POST /auth/login` ou `/auth/register`.' }, 'jwt')
    .build();
  const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, swaggerDocument);
}
