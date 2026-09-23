import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import { BadRequestException, Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { diskStorage } from 'multer';
import { DocumentsService } from './documents.service.js';
import { DocumentsController } from './documents.controller.js';

// Cenário obrigatório #9 do enunciado (integração externa/upload
// controlado): MIME validado antes do arquivo chegar ao Service —
// currículo/carta/certificado, formatos comuns de escritório. Fica aqui
// (não configurável via env) porque não é um parâmetro de ambiente, é uma
// regra de negócio fixa.
const ALLOWED_MIME_TYPES = new Set(['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']);

/**
 * `MulterModule.registerAsync` (não `FileInterceptor('file', {...})` com
 * opções inline no controller): achado da revisão do Docker — o
 * `docker-compose.yml` já passa `UPLOAD_DIR`/`MAX_UPLOAD_SIZE_MB` pro
 * container (documentado desde o `.env.example` da raiz e validado em
 * `env.validation.ts`), mas o controller tinha `UPLOAD_DIR`/
 * `MAX_FILE_SIZE_BYTES` como CONSTANTES calculadas na importação do
 * módulo — as duas variáveis de ambiente nunca eram lidas, e os valores
 * hardcoded só "davam certo" por coincidirem com os defaults do
 * `.env.example`. Um decorator (`@UseInterceptors(FileInterceptor(...))`)
 * tem seus argumentos avaliados na definição da classe, antes de
 * qualquer injeção de dependência rodar — não dá pra injetar
 * `ConfigService` ali dentro. Registrar o Multer no nível do módulo,
 * com `useFactory`, é o jeito idiomático do Nest de tornar essa config
 * dependente de `ConfigService`.
 */
@Module({
  imports: [
    MulterModule.registerAsync({
      useFactory: (configService: ConfigService) => {
        const uploadDir = join(process.cwd(), configService.get<string>('UPLOAD_DIR', 'uploads'));
        if (!existsSync(uploadDir)) {
          mkdirSync(uploadDir, { recursive: true });
        }
        const maxSizeBytes = configService.get<number>('MAX_UPLOAD_SIZE_MB', 5) * 1024 * 1024;

        return {
          storage: diskStorage({
            destination: uploadDir,
            // Nome em disco nunca é o nome original (acidente de path
            // traversal / colisão) — UUID + extensão original só pra
            // manter o tipo de arquivo reconhecível no filesystem.
            filename: (_req, file, callback) => callback(null, `${randomUUID()}${extname(file.originalname)}`),
          }),
          limits: { fileSize: maxSizeBytes },
          fileFilter: (_req, file, callback) => {
            if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
              callback(new BadRequestException({ statusCode: 400, error: 'Bad Request', reason: 'mime_type_invalido', message: `Tipo de arquivo não permitido: ${file.mimetype}.` }), false);
              return;
            }
            callback(null, true);
          },
        };
      },
      inject: [ConfigService],
    }),
  ],
  controllers: [DocumentsController],
  providers: [DocumentsService],
  exports: [DocumentsService],
})
export class DocumentsModule {}
