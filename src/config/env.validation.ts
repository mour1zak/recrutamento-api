import Joi from 'joi';

// O `.when('NODE_ENV', { then, otherwise })` abaixo faz o `oxlint` acusar
// falso-positivo `unicorn/no-thenable` (confunde as chaves `then`/
// `otherwise` da API do Joi com uma Promise). Comentário de disable inline
// não funcionou em nenhuma sintaxe testada (achado Qwen rodada 5, ressalva
// 8) — a regra está desligada só para este arquivo em `.oxlintrc.json`
// (`overrides`), que é a forma que o `oxlint` realmente respeita.

// Valores literais do `.env.example` — se alguém fizer `cp .env.example .env`
// e esquecer de trocar, o processo deve recusar subir, nunca aceitar.
// Achado crítico da auditoria Qwen rodada 4 (C1): sem isso, qualquer pessoa
// que leia o repositório público forja um JWT válido com o segredo
// documentado e autentica como qualquer usuário, inclusive ADMIN.
const PLACEHOLDER_JWT_SECRET = 'troque-por-um-valor-aleatorio-de-32-bytes-em-hex';
const PLACEHOLDER_JWT_REFRESH_SECRET = 'troque-por-outro-valor-aleatorio-de-32-bytes-em-hex';
const PLACEHOLDER_API_KEY = 'troque-por-um-valor-aleatorio';

// Valores do .env.test — versionado de propósito (segredos dedicados a um
// banco de teste descartável, ver .gitignore), mas por isso mesmo públicos
// e permanentes no histórico do Git. Corrige achado Qwen rodada 5 (N4):
// fora de NODE_ENV=test, esses valores viram tão perigosos quanto o
// placeholder do .env.example — alguém poderia forjar um JWT válido pra
// esse ambiente, ou um deploy real acidentalmente subir com NODE_ENV=test.
const TEST_ENV_JWT_SECRET = '7b0501ef6e14a67fe9f13d4c513ca8f7a72c63b2cacaeda016b053ef5bca048f';
const TEST_ENV_API_KEY = '19059b32a370a9771d5d636782d882b7325427cd7401d0d7';

// Mesmo formato aceito por src/common/utils/duration.util.ts — valida aqui
// para falhar no boot (não no primeiro login) se alguém configurar algo
// como "1w" (achado R6 da rodada 4).
const DURATION_PATTERN = /^\d+(s|m|h|d)$/;

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
  PORT: Joi.number().port().default(3000),

  DATABASE_URL: Joi.string().uri({ scheme: ['postgresql', 'postgres'] }).required(),

  JWT_SECRET: Joi.string()
    .min(32)
    .when('NODE_ENV', {
      is: 'test',
      then: Joi.string().invalid(PLACEHOLDER_JWT_SECRET, PLACEHOLDER_JWT_REFRESH_SECRET),
      otherwise: Joi.string().invalid(PLACEHOLDER_JWT_SECRET, PLACEHOLDER_JWT_REFRESH_SECRET, TEST_ENV_JWT_SECRET),
    })
    .required()
    .messages({
      'any.invalid': 'JWT_SECRET não pode ser um valor de exemplo/teste versionado no repositório — gere um novo com `openssl rand -hex 32`.',
    }),
  JWT_EXPIRES_IN: Joi.string().pattern(DURATION_PATTERN).default('15m'),
  JWT_REFRESH_EXPIRES_IN: Joi.string().pattern(DURATION_PATTERN).default('7d'),

  API_KEY: Joi.string()
    .min(16)
    .when('NODE_ENV', {
      is: 'test',
      then: Joi.string().invalid(PLACEHOLDER_API_KEY),
      otherwise: Joi.string().invalid(PLACEHOLDER_API_KEY, TEST_ENV_API_KEY),
    })
    .required()
    .messages({
      'any.invalid': 'API_KEY não pode ser um valor de exemplo/teste versionado no repositório — gere um novo com `openssl rand -hex 24`.',
    }),

  EXTERNAL_CEP_API_URL: Joi.string().uri().default('https://viacep.com.br/ws'),
  EXTERNAL_CEP_TIMEOUT_MS: Joi.number().positive().default(3000),

  UPLOAD_DIR: Joi.string().default('uploads'),
  MAX_UPLOAD_SIZE_MB: Joi.number().positive().default(5),
})
  .custom((value, helpers) => {
    // JWT_SECRET e API_KEY têm papéis diferentes (identidade de usuário x
    // identidade de cliente) — se forem iguais, comprometer um compromete
    // os dois.
    if (value.JWT_SECRET === value.API_KEY) {
      // `helpers.message(...)` (não `helpers.error('any.custom', {...})`):
      // achado Qwen rodada 5 (N7) — a mensagem passada via `context` num
      // `helpers.error` não é renderizada a menos que o schema declare
      // `.messages({'any.custom': '{{#message}}'})`; `helpers.message()`
      // usa o texto literal direto, sem esse passo extra.
      return helpers.message({ custom: 'JWT_SECRET e API_KEY não podem ter o mesmo valor.' });
    }
    return value;
  })
  .unknown(true);
