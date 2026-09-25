import { describe, expect, it } from 'vitest';
import type { InvoiceSummaryDto } from '../../lib/api/entries';
import { describeInvoiceResult, formatVoucherNumber } from './invoiceUtils';

const base: InvoiceSummaryDto = {
  id: 'inv-1',
  status: 'issued',
  cbteTipo: 6,
  ptoVta: 1,
  cbteNro: 1,
  cae: '86380920935994',
  caeVto: '2026-10-04',
  errorCode: null,
  errorMessage: null,
};

describe('invoiceUtils', () => {
  it('formatea el número como ARCA: 0001-00000123', () => {
    expect(formatVoucherNumber(1, 123)).toBe('0001-00000123');
  });

  it('emitida → "Factura B 0001-00000001 emitida"', () => {
    expect(
      describeInvoiceResult({ invoice: base, offline: false, lineModes: [] }),
    ).toEqual({ tone: 'success', text: 'Factura B 0001-00000001 emitida' });
  });

  it('emitida por un monotributista → Factura C', () => {
    expect(
      describeInvoiceResult({
        invoice: { ...base, cbteTipo: 11 },
        offline: false,
        lineModes: [],
      })?.text,
    ).toBe('Factura C 0001-00000001 emitida');
  });

  it('error → el motivo y que quedó pendiente', () => {
    expect(
      describeInvoiceResult({
        invoice: {
          ...base,
          status: 'error',
          errorCode: 'INVOICE_REJECTED',
          errorMessage: '10016: número no correlativo',
        },
        offline: false,
        lineModes: [],
      }),
    ).toEqual({
      tone: 'warning',
      text: 'No se pudo facturar: 10016: número no correlativo. Quedó pendiente.',
    });
  });

  it('no duplica el punto final del motivo', () => {
    expect(
      describeInvoiceResult({
        invoice: {
          ...base,
          status: 'error',
          errorMessage: 'ARCA no respondió en 1 ms.',
        },
        offline: false,
        lineModes: [],
      })?.text,
    ).toBe('No se pudo facturar: ARCA no respondió en 1 ms. Quedó pendiente.');
  });

  it('pendiente, "no requiere" o sin ARCA → no se muestra nada', () => {
    for (const invoice of [
      { ...base, status: 'pending' as const },
      { ...base, status: 'not_required' as const },
      null,
    ]) {
      expect(
        describeInvoiceResult({ invoice, offline: false, lineModes: ['auto'] }),
      ).toBeNull();
    }
  });

  it('offline con medios en Automática → se emite al sincronizar', () => {
    expect(
      describeInvoiceResult({
        invoice: undefined,
        offline: true,
        lineModes: ['auto'],
      })?.text,
    ).toBe('La factura se emite al sincronizar.');
  });

  it('offline con un medio que no es Automática → no se promete nada', () => {
    expect(
      describeInvoiceResult({
        invoice: undefined,
        offline: true,
        lineModes: ['auto', undefined],
      }),
    ).toBeNull();
  });
});
