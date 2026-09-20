import { describe, expect, it } from 'vitest';
import {
  canSetDefault,
  canToggleEnabled,
  isIntegrationBacked,
} from './paymentMethodUtils';

/**
 * El `enabled` de un medio integrado lo decide el backend cuando la cuenta se
 * vincula o se desvincula desde el panel web. Si el desktop lo deja tocar, la
 * operación se encola offline y se aplica a ciegas horas después: el operario
 * ve "Mercado Pago QR" en el egreso y no puede cobrar.
 */
describe('paymentMethodUtils', () => {
  it('mercadopago_qr es integrado: el toggle queda bloqueado', () => {
    expect(isIntegrationBacked('mercadopago_qr')).toBe(true);
    expect(canToggleEnabled('mercadopago_qr')).toBe(false);
  });

  it('los medios comunes se siguen prendiendo y apagando', () => {
    expect(isIntegrationBacked('cash')).toBe(false);
    expect(canToggleEnabled('cash')).toBe(true);
    expect(canToggleEnabled('transfer')).toBe(true);
    expect(canToggleEnabled('other')).toBe(true);
  });

  it('mercadopago_qr tampoco se puede marcar como predeterminado', () => {
    // La fila default no renderiza el toggle de habilitar/deshabilitar: si la
    // integración se cae, el QR muerto queda preseleccionado y sin salida.
    expect(canSetDefault('mercadopago_qr')).toBe(false);
    expect(canSetDefault('cash')).toBe(true);
  });

  it('sin tipo (fila anterior a la v13 de Dexie) se comporta como hoy', () => {
    // `LocalPaymentMethod.type` es opcional por la ventana de upgrade: entre
    // la v13 y el primer pull, una fila ya sincronizada puede no tenerlo.
    // Sin tipo no podemos afirmar que sea integrado, así que no bloqueamos
    // nada que antes funcionara.
    expect(isIntegrationBacked(undefined)).toBe(false);
    expect(canToggleEnabled(undefined)).toBe(true);
    expect(canSetDefault(undefined)).toBe(true);
  });
});
