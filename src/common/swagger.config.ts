import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

/**
 * Extraído de `main.ts` só pra ter UM lugar que monta o Swagger — testes
 * e2e precisam do mesmo setup que a aplicação real usa, e importar
 * `main.ts` direto disparava `bootstrap()` (efeito colateral de
 * `app.listen()`) só por importar o módulo.
 *
 * Histórico da decisão sobre proteger `/docs`: chegamos a colocar
 * `x-api-key` obrigatória (com fallback de Basic Auth pra abrir pelo
 * navegador), mas a UX ficou ruim — o popup nativo de login pede
 * "usuário/senha", e não existe usuário nenhum neste projeto, só a
 * chave compartilhada; forçar alguém a entender "digite qualquer coisa
 * no usuário, a x-api-key na senha" é confuso pra quem só quer ler a
 * documentação. Decisão final, ciente do trade-off: `/docs`/`/docs-json`
 * voltam a ser públicos. A correção que IMPORTA de verdade continua
 * valendo independente dessa escolha: nenhum `example` do Swagger usa
 * uma credencial real do seed (ver `auth/dto/login.dto.ts`) — era isso
 * que tornava a exposição pública perigosa, não a exposição em si.
 */
export function configureSwagger(app: INestApplication): void {
  const swaggerConfig = new DocumentBuilder()
    .setTitle('Plataforma de Recrutamento — API (AV-04)')
    .setDescription(
      'API de uma plataforma de recrutamento: candidatos, empresas, vagas, ' +
        'candidaturas, entrevistas e documentos. Autenticação em duas camadas: ' +
        'a chave `x-api-key` (header) identifica o cliente consumidor da API — ' +
        'obrigatória em toda rota de NEGÓCIO, exceto esta própria documentação, ' +
        'mantida pública deliberadamente; o token JWT (`Authorization: Bearer ' +
        '<token>`) identifica o usuário autenticado. RBAC dinâmico via banco de ' +
        'dados — cada papel (CANDIDATE/RECRUITER/ADMIN, ou um papel custom criado ' +
        'em runtime) tem um conjunto de permissões que controla o acesso rota a rota.',
    )
    .setVersion('1.0')
    .addApiKey({ type: 'apiKey', name: 'x-api-key', in: 'header', description: 'Chave do cliente consumidor da API — obrigatória em toda rota de negócio (não nesta documentação).' }, 'api-key')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: 'Token de acesso obtido em `POST /auth/login` ou `/auth/register`.' }, 'jwt')
    .build();
  const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, swaggerDocument);
}
