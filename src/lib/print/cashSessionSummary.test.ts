import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildCashSessionSummaryHtml,
  printCashSessionSummary,
  type CashSessionPrintData,
} from './cashSessionSummary';
import { setPaperSize } from './printerSettings';
import {
  defaultCashSessionTemplateSettings,
  writeCashSessionTemplateSettings,
} from './cashSessionTemplate';

type Bridge = NonNullable<Window['parkitDesktop']>;

function data(): CashSessionPrintData {
  return {
    parkingName: 'Apex & <Centro>',
    openedAt: '2026-10-10T12:00:00Z',
    closedAt: '2026-10-10T20:00:00Z',
    summary: {
      byPm: [
        {
          pmId: 'cash',
          pmName: 'Efectivo & QR',
          total: 5000,
          count: 2,
          isCash: true,
        },
        {
          pmId: 'mp',
          pmName: 'Mercado Pago',
          total: 3000,
          count: 1,
          isCash: false,
        },
      ],
      grandTotal: 8000,
      txCount: 3,
      openingCash: 100,
      cashCollected: 5000,
      cashTotal: 5100,
    },
    leavingCash: 100,
    notes: 'Turno <sin novedades> & cerrado',
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('resumen impreso del cierre de caja', () => {
  it('muestra período, medios, totales y notas sin duplicar el fondo inicial', () => {
    const html = buildCashSessionSummaryHtml(data());
    expect(html).toContain('Apex &amp; &lt;Centro&gt;');
    expect(html).toContain('10/10/2026, 09:00');
    expect(html).toContain('10/10/2026, 17:00');
    expect(html).toContain('Efectivo &amp; QR');
    expect(html).toContain('Mercado Pago');
    expect(html).toContain('Cobros por medio de pago');
    expect(html).toContain('payment-methods .row + .row');
    expect(html).toContain('Total cobrado');
    expect(html).toContain('8.000,00');
    expect(html).toContain('Efectivo en caja');
    expect(html).toContain('5.100,00');
    expect(html).toContain('Fondo para siguiente turno');
    expect(html).toContain('&lt;sin novedades&gt; &amp; cerrado');
    expect(html).not.toContain('<sin novedades>');
  });

  it('muestra un turno sin movimientos y omite campos opcionales vacíos', () => {
    const empty = data();
    empty.summary = {
      ...empty.summary,
      byPm: [],
      grandTotal: 0,
      cashCollected: 0,
      cashTotal: 100,
    };
    empty.leavingCash = null;
    empty.notes = ' ';
    const html = buildCashSessionSummaryHtml(empty, null);
    expect(html).toContain('Sin movimientos en este turno.');
    expect(html).not.toContain('Fondo para siguiente turno');
    expect(html).not.toContain('<strong>Notas</strong>');
    expect(html).toContain('max-width: 72mm; margin: 0');
  });

  it('respeta visibilidad, orden y tamaño de la plantilla', () => {
    const template = defaultCashSessionTemplateSettings('tenant');
    template.fields = [
      {
        id: 'grandTotal' as const,
        visible: true,
        fontSizePt: 18,
        emphasis: 'bold' as const,
      },
      ...template.fields.filter((field) => field.id !== 'grandTotal'),
    ].map((field) =>
      field.id === 'notes' || field.id === 'openingCash'
        ? { ...field, visible: false }
        : field,
    );
    const html = buildCashSessionSummaryHtml(data(), 48, template);
    expect(html).toContain('width: 48mm');
    expect(html.indexOf('Total cobrado')).toBeLessThan(
      html.indexOf('Apertura'),
    );
    expect(html).toContain('font-size:18pt');
    expect(html).not.toContain('<strong>Notas</strong>');
    expect(html).not.toContain('Fondo inicial');
  });

  it('usa la impresora y el papel configurados', async () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
      removeItem: (key: string) => void values.delete(key),
    };
    setPaperSize('driver', storage);
    vi.stubGlobal('window', { localStorage: storage });
    const printTicket = vi.fn().mockResolvedValue({ ok: true });
    const bridge = { printTicket } as unknown as Bridge;
    await expect(printCashSessionSummary(data(), bridge)).resolves.toEqual({
      ok: true,
    });
    const payload = printTicket.mock.calls[0][0] as {
      mediaWidthMm: number | null;
      bodyWidthMm: number | null;
      html: string;
    };
    expect(payload.mediaWidthMm).toBeNull();
    expect(payload.bodyWidthMm).toBeNull();
    expect(payload.html).toContain('Cierre de caja');
  });

  it('devuelve un resultado fallido si no hay puente de impresión', async () => {
    await expect(printCashSessionSummary(data(), undefined)).resolves.toEqual({
      ok: false,
      reason: 'no-bridge',
    });
  });

  it('lee la plantilla guardada al imprimir el cierre real', async () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
      removeItem: (key: string) => void values.delete(key),
    };
    vi.stubGlobal('window', { localStorage: storage });
    const template = defaultCashSessionTemplateSettings('tenant');
    template.fields = template.fields.map((field) =>
      field.id === 'notes' ? { ...field, visible: false } : field,
    );
    writeCashSessionTemplateSettings(template, storage);
    const printTicket = vi.fn().mockResolvedValue({ ok: true });
    const bridge = { printTicket } as unknown as Bridge;

    await printCashSessionSummary({ ...data(), tenantId: 'tenant' }, bridge);

    const payload = printTicket.mock.calls[0][0] as { html: string };
    expect(payload.html).not.toContain('<strong>Notas</strong>');
    expect(payload.html).toContain('Total cobrado');
  });
});
