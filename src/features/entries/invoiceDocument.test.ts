import { describe, expect, it } from 'vitest';
import {
  formatCurrency,
  formatDate,
  numberToWords,
  renderInvoiceHtml,
  type InvoiceDocumentDto,
} from './invoiceDocument';

const B: InvoiceDocumentDto = {
  emisor: {
    razonSocial: 'DE LA CRUZ JUAN MARTIN',
    domicilioComercial: 'Calle 123, CABA',
    condicionIva: 'IVA Responsable Inscripto',
    cuit: '20447275865',
    iibb: '901-000000-0',
    fechaInicioActividades: '2020-01-01',
  },
  receptor: {
    razonSocial: 'Consumidor Final',
    condicionIva: 'Consumidor Final',
    documentoTipo: 'Sin Identificar',
    documentoNro: '0',
  },
  cbteTipo: 6,
  cbteLetra: 'B',
  puntoVenta: 1,
  cbteNro: 7,
  cbteFecha: '2026-09-24',
  condicionVenta: 'Contado',
  fechaServicioDesde: '2026-09-24',
  fechaServicioHasta: '2026-09-24',
  fechaVtoPago: '2026-09-24',
  items: [
    {
      descripcion: 'Estadía AB123CD – 24/09/2026 10:00 a 24/09/2026 12:30',
      cantidad: 1,
      unidadMedida: 'unidades',
      precioUnitario: 1210,
      subtotal: 1210,
      alicuotaIva: null,
    },
  ],
  importeNetoGravado: 1210,
  iva: [],
  importeIva: 0,
  importeTotal: 1210,
  cae: '86390926440543',
  caeFechaVencimiento: '2026-10-04',
  observaciones:
    'Régimen de Transparencia Fiscal al Consumidor (Ley 27.743) – IVA contenido: $210,00',
  qrUrl: 'https://www.afip.gob.ar/fe/qr/?p=e30=',
};

const A: InvoiceDocumentDto = {
  ...B,
  cbteTipo: 1,
  cbteLetra: 'A',
  receptor: {
    razonSocial: 'EMPRESA SA',
    condicionIva: 'IVA Responsable Inscripto',
    documentoTipo: 'CUIT',
    documentoNro: '30712345671',
  },
  items: [
    { ...B.items[0], precioUnitario: 1000, subtotal: 1000, alicuotaIva: 21 },
  ],
  importeNetoGravado: 1000,
  iva: [{ descripcion: '21%', baseImponible: 1000, importe: 210 }],
  importeIva: 210,
  observaciones: null,
};

describe('renderInvoiceHtml', () => {
  it('B: número, CAE, QR y leyenda de transparencia fiscal', () => {
    const html = renderInvoiceHtml(B, 'data:image/png;base64,QR');

    expect(html).toContain('<div class="letter-box">B</div>');
    expect(html).toContain('COD.006');
    expect(html).toContain('Nro.:00001-00000007');
    expect(html).toContain('CAE N°: 86390926440543');
    expect(html).toContain('Fecha de Vto. de CAE: 04/10/2026');
    expect(html).toContain('src="data:image/png;base64,QR"');
    expect(html).toContain('Ley 27.743');
    expect(html).toContain('20-44727586-5');
    expect(html).toContain('Período facturado:</b> 24/09/2026 al 24/09/2026');
    expect(html).toContain('Subtotal:');
    expect(html).not.toContain('%IVA');
  });

  it('A: IVA discriminado y CUIT del receptor', () => {
    const html = renderInvoiceHtml(A, null);

    expect(html).toContain('Subtotal s/IVA');
    expect(html).toContain('>21%<');
    expect(html).toContain(
      `IVA 21%:</span><span class="totals-value">${formatCurrency(210)}`,
    );
    expect(html).toContain('CUIT:</b> 30-71234567-1');
    expect(html).not.toContain('class="qr-img"');
    expect(html).not.toContain('Observaciones');
  });

  it('C: sin IVA ni tabla de otros tributos', () => {
    const html = renderInvoiceHtml(
      {
        ...B,
        cbteTipo: 11,
        cbteLetra: 'C',
        emisor: { ...B.emisor, condicionIva: 'Responsable Monotributo' },
        observaciones: null,
      },
      null,
    );

    expect(html).toContain('COD.011');
    expect(html).toContain('Importe Neto Gravado:');
    expect(html).not.toContain('Otros Tributos');
    expect(html).not.toContain('IVA 21%');
  });

  it('escapa lo que viene de la factura', () => {
    const html = renderInvoiceHtml(
      {
        ...B,
        emisor: {
          ...B.emisor,
          razonSocial: '<script>alert(1)</script> & Hnos',
        },
      },
      null,
    );

    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; Hnos');
  });
});

describe('formatos', () => {
  it('fecha, moneda y total en letras', () => {
    expect(formatDate('2026-09-24')).toBe('24/09/2026');
    expect(formatCurrency(1234567.5)).toBe('$\u00a01.234.567,50');
    expect(numberToWords(1210)).toBe('MIL DOSCIENTOS DIEZ CON 00/100');
    expect(numberToWords(21.5)).toBe('VEINTIÚN CON 50/100');
    expect(numberToWords(1_000_000)).toBe('UN MILLÓN CON 00/100');
  });
});
