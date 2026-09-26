import { describe, expect, it } from 'vitest';
import type { InvoiceSummaryDto } from '../../lib/api/entries';
import {
  canChooseInvoiceA,
  canIssueAfterCharge,
  describeInvoiceResult,
  describeIssueConfirmation,
  formatVoucherNumber,
  isValidCuit,
  receiverCuitError,
} from './invoiceUtils';
import {
  countInvoiceChips,
  invoicePdfFileName,
  resolveInvoiceState,
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
      text: 'Factura A 0001-00000001 emitida',
      detail: 'a EMPRESA SA',
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

  it('confirmación de emisión: dice letra, a quién y el monto', () => {
    expect(
      describeIssueConfirmation({
        letter: 'A',
        cuit: '30712345671',
        amount: '$ 5.200,00',
      }),
    ).toEqual({
      title: '¿Emitir la Factura A?',
      message:
        'Se emite al CUIT 30-71234567-1 por $ 5.200,00. Una factura emitida no se puede anular desde Parkit.',
      confirmLabel: 'Emitir Factura A',
    });
    expect(
      describeIssueConfirmation({ letter: 'B', cuit: null, amount: '$ 10,00' })
        .message,
    ).toMatch(/^Se emite a consumidor final por \$ 10,00\./);
  });
});

describe('historial: estado de facturación (gemelo del panel web)', () => {
  const paid = { leftAt: '2026-09-24T15:30:00.000Z', paidTotal: 1210 };

  it('manda el estado de la factura; sin ella, sin factura o facturada a mano', () => {
    expect(resolveInvoiceState(paid, { status: 'issued' })).toBe('issued');
    expect(resolveInvoiceState(paid, { status: 'not_required' })).toBe('none');
    expect(
      resolveInvoiceState({ ...paid, manuallyInvoiced: true }, undefined),
    ).toBe('manual');
    expect(
      resolveInvoiceState({ leftAt: null, paidTotal: null }, undefined),
    ).toBe('na');
  });

  it('«Sin facturar» cuenta Pendiente + Sin factura + Con error', () => {
    const rows = (
      ['pending', 'none', 'error', 'issued', 'manual', 'na'] as const
    ).map((invoiceState) => ({ invoiceState }));
    expect(countInvoiceChips(rows)).toEqual({ all: 6, unbilled: 3 });
  });

  it('el PDF se llama patente-CAE-número.pdf', () => {
    expect(
      invoicePdfFileName({
        plate: 'AB123CD',
        cae: '86390928613357',
        ptoVta: 1,
        cbteNro: 6,
      }),
    ).toBe('AB123CD-86390928613357-0001-00000006.pdf');
  });
});
