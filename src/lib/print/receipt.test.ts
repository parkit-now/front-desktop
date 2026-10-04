import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildPaymentReceiptHtml,
  describeReceiptPrintFailure,
  printReceipt,
  type ReceiptData,
} from './receipt';
import { setPaperSize } from './printerSettings';

type Bridge = NonNullable<Window['parkitDesktop']>;

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

function receipt(overrides: Partial<ReceiptData> = {}): ReceiptData {
  return {
    parkingName: 'Estacionamiento Apex',
    parkingAddress: 'Balcarce 560',
    parkingCuit: '20-16865508-0',
    plate: 'IAG571',
    ticketNumber: 10,
    amountDue: 170000,
    received: 180000,
    change: 10000,
    paymentMethodName: 'Efectivo',
    enteredAt: '2026-09-17T12:28:00Z',
    leftAt: '2026-09-18T14:46:00Z',
    ...overrides,
  };
}

function bridgeWith(printTicket: Bridge['printTicket']): Bridge {
  return { printTicket } as unknown as Bridge;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('buildPaymentReceiptHtml', () => {
  it('arma un comprobante no fiscal compacto con los datos obligatorios', () => {
    const html = buildPaymentReceiptHtml(receipt());
    expect(html).toContain('Comprobante de pago no fiscal');
    expect(html).toContain('IAG571');
    expect(html).toMatch(/\$\s*170\.000,00/);
    expect(html).toContain('17/09/2026, 09:28');
    expect(html).toContain('18/09/2026, 11:46');
    expect(html).toContain('No válido como factura');
  });

  it('usa el ancho del papel configurado', () => {
    expect(buildPaymentReceiptHtml(receipt(), { bodyWidthMm: 48 })).toContain(
      'width: 48mm',
    );
  });

  it('se adapta al ancho del driver cuando no hay tamaño declarado', () => {
    const html = buildPaymentReceiptHtml(receipt(), { bodyWidthMm: null });
    expect(html).toContain('width: 100%');
    expect(html).toContain('max-width: 72mm; margin: 0;');
  });

  it('omite valores opcionales vacíos y escapa texto cargado', () => {
    const html = buildPaymentReceiptHtml(
      receipt({
        parkingAddress: null,
        parkingName: '<img src=x onerror=alert(1)>',
        paymentMethodName: 'Efectivo & QR',
        received: undefined,
        change: undefined,
      }),
    );
    expect(html).not.toContain('Balcarce 560');
    expect(html).toContain('&lt;img');
    expect(html).not.toContain('<img');
    expect(html).toContain('Efectivo &amp; QR');
    expect(html).not.toContain('Recibido');
    expect(html).not.toContain('Vuelto');
  });

  it('respeta orden, visibilidad y tamaño de la plantilla no fiscal', () => {
    const html = buildPaymentReceiptHtml(receipt(), {
      template: {
        version: 1,
        tenantId: 'tenant-1',
        cuitOverride: '',
        grossIncomeText: '',
        nonFiscalControlText: '',
        fields: [
          { id: 'amount', visible: true, fontSizePt: 18, emphasis: 'bold' },
          { id: 'plate', visible: true, fontSizePt: 12, emphasis: 'bold' },
          {
            id: 'paymentMethod',
            visible: false,
            fontSizePt: 9,
            emphasis: 'normal',
          },
        ],
      },
    });

    expect(html.indexOf('170.000,00')).toBeLessThan(
      html.indexOf('<span>IAG571</span>'),
    );
    expect(html).toContain('font-size:18pt');
    expect(html).toContain('font-size:12pt');
    expect(html).not.toContain('Efectivo');
  });
});

describe('printReceipt', () => {
  it('avisa cuando no está el puente de Electron', async () => {
    await expect(printReceipt(receipt(), undefined)).resolves.toEqual({
      ok: false,
      reason: 'no-bridge',
    });
  });

  it('imprime usando la configuración local de impresora', async () => {
    const printTicket = vi.fn().mockResolvedValue({ ok: true });
    await expect(
      printReceipt(receipt(), bridgeWith(printTicket)),
    ).resolves.toEqual({ ok: true });

    const payload = printTicket.mock.calls[0][0] as {
      html: string;
      mediaWidthMm: number | null;
      bodyWidthMm: number | null;
    };
    expect(payload.html).toContain('Comprobante de pago no fiscal');
    expect(payload.mediaWidthMm).toBe(80);
    expect(payload.bodyWidthMm).toBe(72);
  });

  it('lee la plantilla no fiscal del tenant antes de imprimir', async () => {
    const storage = new MemoryStorage();
    storage.setItem(
      'parkit.desktop.paymentReceiptTemplate:tenant-9',
      JSON.stringify({
        fields: [
          { id: 'amount', visible: true, fontSizePt: 18, emphasis: 'bold' },
          { id: 'plate', visible: true, fontSizePt: 12, emphasis: 'bold' },
          {
            id: 'paymentMethod',
            visible: false,
            fontSizePt: 9,
            emphasis: 'normal',
          },
        ],
      }),
    );
    vi.stubGlobal('window', { localStorage: storage });
    const printTicket = vi.fn().mockResolvedValue({ ok: true });

    await expect(
      printReceipt(receipt({ tenantId: 'tenant-9' }), bridgeWith(printTicket)),
    ).resolves.toEqual({ ok: true });

    const payload = printTicket.mock.calls[0][0] as { html: string };
    expect(payload.html).toContain('font-size:18pt');
    expect(payload.html).not.toContain('Efectivo');
  });

  it('respeta el modo avanzado del driver', async () => {
    const storage = new MemoryStorage();
    setPaperSize('driver', storage);
    vi.stubGlobal('window', { localStorage: storage });
    const printTicket = vi.fn().mockResolvedValue({ ok: true });

    await expect(
      printReceipt(receipt(), bridgeWith(printTicket)),
    ).resolves.toEqual({ ok: true });

    const payload = printTicket.mock.calls[0][0] as {
      html: string;
      mediaWidthMm: number | null;
      bodyWidthMm: number | null;
    };
    expect(payload.mediaWidthMm).toBeNull();
    expect(payload.bodyWidthMm).toBeNull();
    expect(payload.html).toContain('width: 100%');
  });
});

describe('describeReceiptPrintFailure', () => {
  it('devuelve mensajes para fallas de impresión', () => {
    expect(
      describeReceiptPrintFailure({ ok: false, reason: 'printer-not-found' }),
    ).toContain('Impresora');
    expect(describeReceiptPrintFailure({ ok: true })).toBe('');
  });
});
