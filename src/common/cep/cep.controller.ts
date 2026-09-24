import { BadGatewayException, BadRequestException, Controller, Get, Param } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { CEP_UNAVAILABLE_WARNING, CepService } from './cep.service.js';
import { Public } from '../decorators/public.decorator.js';
import { errorBody } from '../exceptions/error-body.util.js';

const CEP_FORMAT = /^\d{5}-?\d{3}$/;

/**
 * Rota de utilidade (não exigida pelo enunciado, pedida à parte): expõe o
 * `CepService` já existente pro frontend consultar um CEP isoladamente,
 * ANTES de submeter o formulário inteiro de `Company`/`CandidateProfile`
 * — o padrão "digita o CEP, autopreenche rua/cidade/estado" que
 * `POST /companies`/`PATCH /candidates/me` não davam de forma
 * independente (lá o CEP só é resolvido junto com o resto do formulário).
 *
 * Mesmo contrato discriminado do Service, mapeado pra HTTP:
 * `ok` → 200 com o endereço; `invalid` → 400 (mesmo `reason` já usado em
 * Companies/CandidateProfile, pra não criar um segundo vocabulário de
 * erro pro mesmo caso); `unavailable` → 502 (a falha é do PROVEDOR
 * externo, não de quem perguntou — diferente de `invalid`, que é erro de
 * quem enviou o CEP).
 *
 * `@Public()` + só API key (sem permission key): mesma classe de rota
 * pública de utilidade que `GET /jobs` (vitrine) e `GET /health` — não
 * há dado de usuário envolvido, é a mesma informação que o ViaCEP já
 * devolve de graça pra qualquer um, e tanto RECRUITER/ADMIN (criando
 * empresa) quanto CANDIDATE (editando o próprio perfil) precisam dela.
 */
@ApiTags('CEP')
@ApiSecurity('api-key')
@Controller('cep')
export class CepController {
  constructor(private readonly cepService: CepService) {}

  @ApiOperation({ summary: 'Consultar endereço por CEP', description: 'Utilidade pro frontend autopreencher rua/cidade/estado antes de submeter o formulário de empresa ou perfil — não persiste nada, só consulta.' })
  @ApiParam({ name: 'cep', description: 'CEP com ou sem máscara.', example: '01310-100' })
  @ApiResponse({ status: 200, description: 'CEP resolvido.', schema: { properties: { street: { type: 'string' }, city: { type: 'string' }, state: { type: 'string' } } } })
  @ApiResponse({ status: 400, description: 'Formato inválido, ou o provedor confirma que o CEP não existe (`reason: "cep_nao_encontrado"`).' })
  @ApiResponse({ status: 401, description: 'API key ausente/inválida.' })
  @ApiResponse({ status: 502, description: 'Provedor externo de CEP indisponível (timeout/erro de rede) — transitório, tente de novo.' })
  @Public()
  @Get(':cep')
  async lookup(@Param('cep') cep: string) {
    if (!CEP_FORMAT.test(cep)) {
      throw new BadRequestException(errorBody(400, 'cep_formato_invalido', 'CEP deve ter o formato 00000-000 ou 00000000.'));
    }

    const resolution = await this.cepService.resolve(cep);

    if (resolution.status === 'invalid') {
      throw new BadRequestException(errorBody(400, 'cep_nao_encontrado', 'CEP informado não existe.'));
    }
    if (resolution.status === 'unavailable') {
      throw new BadGatewayException(errorBody(502, 'servico_cep_indisponivel', CEP_UNAVAILABLE_WARNING));
    }

    return { street: resolution.street, city: resolution.city, state: resolution.state };
  }
}
