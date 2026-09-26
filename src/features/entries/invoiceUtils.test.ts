import { describe, expect, it } from 'vitest';
import type { InvoiceSummaryDto } from '../../lib/api/entries';
import {
  canIssueAfterCharge,
  consumerFinalLetter,
  describeTaxpayerLookup,
  expectedLetter,
  isReceiverReady,
  receiverCuitToSend,
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

  it('a consumidor final: B si la playa es RI, C si no', () => {
    expect(consumerFinalLetter('responsable_inscripto')).toBe('B');
    expect(consumerFinalLetter('monotributo')).toBe('C');
    expect(consumerFinalLetter(null)).toBe('C');
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

  it('confirmación con razón social y sin letra conocida', () => {
    expect(
      describeIssueConfirmation({
        letter: null,
        cuit: '30712345671',
        receiverName: 'EMPRESA SA',
        amount: '$ 10,00',
      }),
    ).toEqual({
      title: '¿Emitir la factura?',
      message:
        'Se emite a EMPRESA SA (CUIT 30-71234567-1) por $ 10,00. Una factura emitida no se puede anular desde Parkit.',
      confirmLabel: 'Emitir',
    });
  });

  it('la emitida con CUIT dice a quién, en cualquier letra', () => {
    expect(
      describeInvoiceResult({
        invoice: {
          ...base,
          cbteTipo: 6,
          receptorNombre: 'FUNDACION',
        },
        offline: false,
        lineModes: [],
      })?.detail,
    ).toBe('a FUNDACION');
    expect(
      describeInvoiceResult({
        invoice: { ...base, receptorNombre: 'Consumidor Final' },
        offline: false,
        lineModes: [],
      })?.detail,
    ).toBeUndefined();
  });
});

describe('receptor con CUIT (padrón)', () => {
  const taxpayer = {
    cuit: '30712345671',
    identified: true,
    letter: 'A' as const,
    razonSocial: 'EMPRESA SA',
    condicionIvaReceptorId: 1,
    condicionIva: 'IVA Responsable Inscripto',
    assumed: false,
  };
  const done = { status: 'done' as const, taxpayer };

  it('manda el CUIT sólo si es válido y el padrón no dijo que no existe', () => {
    const cuit = '30-71234567-1';
    expect(receiverCuitToSend({ choice: 'final', cuit, lookup: done })).toBe(
      undefined,
    );
    expect(receiverCuitToSend({ choice: 'cuit', cuit, lookup: done })).toBe(
      '30712345671',
    );
    expect(
      receiverCuitToSend({
        choice: 'cuit',
        cuit,
        lookup: {
          status: 'done',
          taxpayer: { ...taxpayer, identified: false },
        },
      }),
    ).toBeUndefined();
    // ARCA caída: se manda igual, el backend vuelve a consultar al emitir.
    expect(
      receiverCuitToSend({
        choice: 'cuit',
        cuit,
        lookup: { status: 'error', message: 'x' },
      }),
    ).toBe('30712345671');
    expect(
      receiverCuitToSend({ choice: 'cuit', cuit: '30712345670', lookup: done }),
    ).toBeUndefined();
  });

  it('con CUIT se confirma recién cuando el padrón contestó', () => {
    const cuit = '30712345671';
    expect(
      isReceiverReady({
        choice: 'final',
        cuit: '',
        lookup: { status: 'idle' },
      }),
    ).toBe(true);
    expect(
      isReceiverReady({ choice: 'cuit', cuit, lookup: { status: 'loading' } }),
    ).toBe(false);
    expect(isReceiverReady({ choice: 'cuit', cuit, lookup: done })).toBe(true);
    expect(
      isReceiverReady({
        choice: 'cuit',
        cuit,
        lookup: { status: 'error', message: 'x' },
      }),
    ).toBe(true);
    expect(
      isReceiverReady({ choice: 'cuit', cuit: '3071', lookup: done }),
    ).toBe(false);
  });

  it('la letra esperada: la de consumidor final, la del padrón o todavía no', () => {
    expect(
      expectedLetter({
        emitter: 'responsable_inscripto',
        choice: 'final',
        lookup: done,
      }),
    ).toBe('B');
    expect(
      expectedLetter({
        emitter: 'responsable_inscripto',
        choice: 'cuit',
        lookup: done,
      }),
    ).toBe('A');
    expect(
      expectedLetter({
        emitter: 'responsable_inscripto',
        choice: 'cuit',
        lookup: { status: 'loading' },
      }),
    ).toBeNull();
    expect(
      expectedLetter({
        emitter: 'monotributo',
        choice: 'cuit',
        lookup: { status: 'loading' },
      }),
    ).toBe('C');
  });

  it('describe lo que dijo el padrón', () => {
    expect(describeTaxpayerLookup({ status: 'idle' })).toBeNull();
    expect(describeTaxpayerLookup(done)).toEqual({
      tone: 'success',
      text: 'Factura A · EMPRESA SA',
      detail: 'IVA Responsable Inscripto',
    });
    expect(
      describeTaxpayerLookup({
        status: 'done',
        taxpayer: {
          ...taxpayer,
          letter: 'B',
          razonSocial: 'FUNDACION',
          condicionIvaReceptorId: 4,
          condicionIva: 'IVA Sujeto Exento',
        },
      }),
    ).toEqual({
      tone: 'info',
      text: 'Factura B · FUNDACION',
      detail: 'IVA Sujeto Exento: no recibe Factura A.',
    });
    expect(
      describeTaxpayerLookup({
        status: 'done',
        taxpayer: {
          ...taxpayer,
          identified: false,
          letter: 'B',
          razonSocial: null,
          condicionIvaReceptorId: null,
          condicionIva: null,
        },
      }),
    ).toEqual({
      tone: 'warning',
      text: 'ARCA no tiene datos de ese CUIT.',
      detail: 'Se emite Factura B a consumidor final.',
    });
    expect(
      describeTaxpayerLookup({
        status: 'done',
        taxpayer: { ...taxpayer, razonSocial: null, assumed: true },
      }),
    ).toMatchObject({
      tone: 'info',
      text: 'Factura A · CUIT 30-71234567-1',
    });
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
