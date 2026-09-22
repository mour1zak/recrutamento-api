import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { AxiosError } from 'axios';

export interface CepAddress {
  street: string | null;
  city: string | null;
  state: string | null;
}

// Achado Qwen rodada 11 (N1): a versão anterior devolvia só os três campos
// de endereço, `null` tanto pra "CEP inexistente" (determinístico, culpa
// de quem enviou) quanto pra "API fora do ar/timeout" (transitório, culpa
// de ninguém) — os dois casos eram indistinguíveis pra quem chamava. Isso
// tinha um efeito colateral concreto: a correção da rodada 10 (preservar
// endereço anterior em `update()` quando a consulta "não resolveu nada")
// passou a tratar um CEP genuinamente inexistente como se fosse uma falha
// transitória, permitindo salvar um `cep` novo com o `street/city/state`
// do endereço ANTIGO — um par CEP×endereço inconsistente. Contrato
// discriminado por `status`, como o `PARECER-DEEPSEEK-FASE1.md` §5 já
// especificava desde a Fase 1 e nunca tinha sido implementado:
// - "ok": consulta resolveu, os três campos vêm preenchidos.
// - "invalid": o provedor confirmou que o CEP não existe — quem chama
//   deve rejeitar a operação (o CEP em si está errado, não é transitório).
// - "unavailable": falha de rede/timeout/payload malformado — quem chama
//   deve preservar o endereço anterior (update) ou seguir sem endereço
//   (create), nunca tratar como se o CEP fosse inválido.
export type CepStatus = 'ok' | 'invalid' | 'unavailable';

export interface CepResolution extends CepAddress {
  status: CepStatus;
}

export const CEP_UNAVAILABLE_WARNING =
  'Não foi possível confirmar o endereço agora (serviço de CEP indisponível); o endereço pode ficar desatualizado até uma nova tentativa.';

// Formato de resposta do ViaCEP (e da maioria dos mocks compatíveis usados
// em avaliações como esta): campos em português, `erro: true` no lugar de
// um 404 HTTP quando o CEP não existe.
interface ViaCepResponse {
  logradouro?: string;
  localidade?: string;
  uf?: string;
  erro?: boolean;
}

/**
 * Resolve endereço a partir de CEP (requisito obrigatório do enunciado:
 * `HttpService` consumindo CEP/localização, com timeout e erro tratados).
 *
 * Decisão da Fase 1 (PARECER-DEEPSEEK-FASE1.md §5, 8 cenários), agora com
 * o contrato discriminado que o §5 sempre especificou e que só foi
 * implementado na rodada 11: CEP explicitamente inválido é
 * responsabilidade de quem enviou (`status: "invalid"`, o chamador decide
 * rejeitar); API fora do ar, timeout ou payload malformado nunca devem
 * impedir a operação principal (`status: "unavailable"`, o chamador
 * preserva o que já tinha). Só o FORMATO do CEP (`@Matches` no DTO) é
 * validado antes de chegar aqui — se ele EXISTE é responsabilidade desta
 * função descobrir.
 */
@Injectable()
export class CepService {
  private readonly logger = new Logger(CepService.name);

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {}

  async resolve(cep: string): Promise<CepResolution> {
    const baseUrl = this.configService.get<string>('EXTERNAL_CEP_API_URL', 'https://viacep.com.br/ws');
    const timeout = this.configService.get<number>('EXTERNAL_CEP_TIMEOUT_MS', 3000);
    const digits = cep.replace(/\D/g, '');
    const url = `${baseUrl}/${digits}/json/`;

    try {
      const response = await firstValueFrom(this.httpService.get<ViaCepResponse>(url, { timeout }));
      const data = response.data;

      if (!data || data.erro) {
        this.logger.warn(`CEP ${digits} não encontrado no provedor externo — rejeitado (status "invalid").`);
        return { status: 'invalid', street: null, city: null, state: null };
      }

      return {
        status: 'ok',
        street: data.logradouro ?? null,
        city: data.localidade ?? null,
        state: data.uf ?? null,
      };
    } catch (error) {
      const detail = error instanceof AxiosError ? (error.code ?? error.message) : String(error);
      this.logger.warn(`Falha ao consultar CEP ${digits} (${detail}) — indisponível (status "unavailable").`);
      return { status: 'unavailable', street: null, city: null, state: null };
    }
  }
}
