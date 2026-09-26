import { describe, expect, it } from 'vitest';
import type { InvoiceSummaryDto } from '../../lib/api/entries';
import {
  canChooseInvoiceA,
  canIssueAfterCharge,
  describeInvoiceResult,
  formatVoucherNumber,
  isValidCuit,
  receiverCuitError,
} from './invoiceUtils';

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

  it('ARCA caída → mensaje corto en el resumen, sin el detalle técnico', () => {
    expect(
      describeInvoiceResult({
        invoice: {
          ...base,
          status: 'error',
          errorCode: 'ARCA_UNAVAILABLE',
          errorMessage: 'ARCA no respondió en 1 ms.',
        },
        offline: false,
        lineModes: [],
      }),
    ).toEqual({
      tone: 'warning',
      text: 'ARCA no responde. Intentalo más tarde.',
    });
  });

  it('un código sin traducción cae en un mensaje genérico, nunca en el detalle técnico', () => {
    expect(
      describeInvoiceResult({
        invoice: {
          ...base,
          status: 'issuing',
          errorCode: 'ALGO_NUEVO',
          errorMessage: 'SOAP fault 500',
        },
        offline: false,
        lineModes: [],
      })?.text,
    ).toBe('No se pudo emitir la factura. Intentalo más tarde.');
  });

  it('pendiente con motivo (certificado vencido) → el motivo corto', () => {
    expect(
      describeInvoiceResult({
        invoice: { ...base, status: 'pending', errorCode: 'ARCA_CERT_EXPIRED' },
        offline: false,
        lineModes: [],
      }),
    ).toEqual({
      tone: 'warning',
      text: 'Venció el certificado de ARCA. Avisale al dueño para que lo renueve.',
    });
  });

  it('pendiente sin motivo (medio en Manual), "no requiere" o sin ARCA → nada', () => {
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

  it('Factura A emitida dice a quién', () => {
    expect(
      describeInvoiceResult({
        invoice: { ...base, cbteTipo: 1, receptorNombre: 'EMPRESA SA' },
        offline: false,
        lineModes: [],
      }),
    ).toEqual({
      tone: 'success',
      text: 'Factura A 0001-00000001 emitida a EMPRESA SA',
    });
  });

  it('valida el CUIT con dígito verificador, con o sin guiones', () => {
    expect(isValidCuit('30712345671')).toBe(true);
    expect(isValidCuit('30712345670')).toBe(false);
    expect(receiverCuitError('30-71234567-1')).toBeNull();
    expect(receiverCuitError('')).toBe('Ingresá el CUIT del cliente.');
    expect(receiverCuitError('30-71234567-0')).toBe('El CUIT no es válido.');
  });

  it('sólo un Responsable Inscripto elige entre A y B', () => {
    expect(canChooseInvoiceA('responsable_inscripto')).toBe(true);
    expect(canChooseInvoiceA('monotributo')).toBe(false);
    expect(canChooseInvoiceA(null)).toBe(false);
  });

  it('«Emitir factura» después del cobro: pendiente o con error, no emitida ni sin factura', () => {
    expect(canIssueAfterCharge({ ...base, status: 'pending' })).toBe(true);
    expect(canIssueAfterCharge({ ...base, status: 'error' })).toBe(true);
    expect(canIssueAfterCharge(base)).toBe(false);
    expect(canIssueAfterCharge({ ...base, status: 'not_required' })).toBe(
      false,
    );
    expect(canIssueAfterCharge(null)).toBe(false);
  });
});
