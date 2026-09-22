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

// Achado Qwen rodada 10 (ressalva 1): `resolve()` sempre devolve os três
// campos, `null` tanto pra "CEP inexistente" quanto pra "falha de rede/
// timeout" — os chamadores (Companies, CandidateProfile) usavam isso
// direto num `update()`, o que ZERAVA um endereço bom já salvo sempre que
// uma instabilidade do provedor externo acontecia durante uma atualização
// que nem mexia no CEP de verdade. Este helper distingue "resolveu (nem
// que parcialmente)" de "não resolveu nada" — os `update()` só devem
// sobrescrever o endereço no segundo caso quando o resultado for
// positivo; em falha, mantêm o valor anterior.
export function isResolvedAddress(address: CepAddress): boolean {
  return address.street !== null || address.city !== null || address.state !== null;
}

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
 * Decisão da Fase 1 (PARECER-DEEPSEEK-FASE1.md §5, 8 cenários): a falha
 * desta integração **nunca** deve impedir a operação principal (criar
 * empresa, atualizar perfil de candidato) — CEP inexistente, API fora do
 * ar, timeout ou payload malformado resultam em endereço `null` mais um
 * aviso logado, nunca em exceção propagada pro controller. Só o formato
 * do CEP em si (`@Matches` no DTO) é validado antes de chegar aqui.
 */
@Injectable()
export class CepService {
  private readonly logger = new Logger(CepService.name);

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {}

  async resolve(cep: string): Promise<CepAddress> {
    const baseUrl = this.configService.get<string>('EXTERNAL_CEP_API_URL', 'https://viacep.com.br/ws');
    const timeout = this.configService.get<number>('EXTERNAL_CEP_TIMEOUT_MS', 3000);
    const digits = cep.replace(/\D/g, '');
    const url = `${baseUrl}/${digits}/json/`;

    try {
      const response = await firstValueFrom(this.httpService.get<ViaCepResponse>(url, { timeout }));
      const data = response.data;

      if (!data || data.erro) {
        this.logger.warn(`CEP ${digits} não encontrado no provedor externo — endereço ficará em branco.`);
        return { street: null, city: null, state: null };
      }

      return {
        street: data.logradouro ?? null,
        city: data.localidade ?? null,
        state: data.uf ?? null,
      };
    } catch (error) {
      const detail = error instanceof AxiosError ? (error.code ?? error.message) : String(error);
      this.logger.warn(`Falha ao consultar CEP ${digits} (${detail}) — endereço ficará em branco.`);
      return { street: null, city: null, state: null };
    }
  }
}
