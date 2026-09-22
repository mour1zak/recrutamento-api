import { describe, expect, it, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { of, throwError } from 'rxjs';
import { AxiosError } from 'axios';
import { CepService } from './cep.service.js';

// Único ponto do projeto onde mockar uma dependência externa é a
// ferramenta certa (ao contrário do banco, que o projeto sempre exercita
// de verdade): aqui queremos provar especificamente o caminho de timeout/
// erro de rede, que não dá pra provocar de forma determinística contra o
// ViaCEP real (usado sem mock em test/companies.e2e-spec.ts para os
// cenários de sucesso e "CEP inexistente").
describe('CepService', () => {
  async function build(get: ReturnType<typeof vi.fn>) {
    const moduleRef = await Test.createTestingModule({
      providers: [
        CepService,
        { provide: HttpService, useValue: { get } },
        { provide: ConfigService, useValue: { get: (_key: string, fallback: unknown) => fallback } },
      ],
    }).compile();
    return moduleRef.get(CepService);
  }

  // Achado Qwen rodada 11 (N1): antes, os dois casos abaixo (CEP
  // inexistente e falha de rede) devolviam o mesmo formato (`{street:
  // null, city: null, state: null}`), indistinguíveis pra quem chamava —
  // era exatamente essa ambiguidade que permitia gravar um `cep` novo com
  // o endereço ANTIGO quando o CEP era só inválido, não indisponível.
  // Agora o `status` discrimina os dois.
  it('timeout na chamada externa -> status "unavailable", endereço em branco, sem lançar', async () => {
    const get = vi.fn().mockReturnValue(throwError(() => new AxiosError('timeout of 3000ms exceeded', 'ECONNABORTED')));
    const service = await build(get);

    const result = await service.resolve('01310-100');

    expect(result).toEqual({ status: 'unavailable', street: null, city: null, state: null });
  });

  it('resposta 2xx mas payload com erro:true (CEP inexistente) -> status "invalid", endereço em branco', async () => {
    const get = vi.fn().mockReturnValue(of({ data: { erro: true } }));
    const service = await build(get);

    const result = await service.resolve('00000-000');

    expect(result).toEqual({ status: 'invalid', street: null, city: null, state: null });
  });

  it('resposta válida -> status "ok", endereço preenchido', async () => {
    const get = vi.fn().mockReturnValue(of({ data: { logradouro: 'Av. Paulista', localidade: 'São Paulo', uf: 'SP' } }));
    const service = await build(get);

    const result = await service.resolve('01310-100');

    expect(result).toEqual({ status: 'ok', street: 'Av. Paulista', city: 'São Paulo', state: 'SP' });
  });
});
