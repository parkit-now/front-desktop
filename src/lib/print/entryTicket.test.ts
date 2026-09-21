import { describe, expect, it } from 'vitest';
import {
  buildEntryTicketHtml,
  formatTicketDate,
  formatTicketTime,
} from './entryTicket';
import type { EntryTicketData } from './entryTicket';

function ticket(overrides: Partial<EntryTicketData> = {}): EntryTicketData {
  return {
    parkingName: 'Estacionamiento Apex',
    parkingAddress: 'Balcarce 560',
    parkingCuit: '20-16865508-0',
    plate: 'ABC123',
    vehicleBrand: 'VW',
    vehicleModel: 'Suran',
    color: 'Negra',
    // Instante UTC fijo: el formateo está clavado a Argentina, así que el
    // resultado no depende de la zona de la máquina que corre el test.
    enteredAt: '2026-09-14T16:43:00Z',
    rateNumber: 2,
    ticketNumber: 5,
    ...overrides,
  };
}

describe('formatTicketTime', () => {
  it('formatea la hora en zona Argentina', () => {
    expect(formatTicketTime('2026-09-14T16:43:00Z')).toBe('13:43 hs');
  });

  it('completa con cero a la izquierda', () => {
    expect(formatTicketTime('2026-09-14T12:05:00Z')).toBe('09:05 hs');
  });

  it('devuelve vacío con una fecha inválida', () => {
    expect(formatTicketTime('no-es-fecha')).toBe('');
  });
});

describe('formatTicketDate', () => {
  it('formatea la fecha como DD/MM/AAAA', () => {
    expect(formatTicketDate('2026-09-14T16:43:00Z')).toBe('14/09/2026');
  });

  it('usa el día de Argentina, no el UTC', () => {
    // 02:30 UTC del 15 son las 23:30 del 14 en Buenos Aires: si esto se
    // rompe, el ticket le imprime al cliente un día que no es.
    expect(formatTicketDate('2026-09-15T02:30:00Z')).toBe('14/09/2026');
    expect(formatTicketTime('2026-09-15T02:30:00Z')).toBe('23:30 hs');
  });

  it('devuelve vacío con una fecha inválida', () => {
    expect(formatTicketDate('no-es-fecha')).toBe('');
  });
});

describe('buildEntryTicketHtml', () => {
  it('imprime los datos del ingreso', () => {
    const html = buildEntryTicketHtml(ticket());
    expect(html).toContain('Estacionamiento Apex');
    expect(html).toContain('Balcarce 560');
    expect(html).toContain('20-16865508-0');
    expect(html).toContain('ABC123');
    expect(html).toContain('VW');
    expect(html).toContain('Suran');
    expect(html).toContain('Negra');
    expect(html).toContain('14/09/2026');
    expect(html).toContain('13:43 hs');
    expect(html).toContain('>5<');
  });

  it('nombra el trabajo de impresión para que la cola del SO sea legible', () => {
    expect(buildEntryTicketHtml(ticket())).toContain(
      '<title>Ticket 5 · Estacionamiento Apex</title>',
    );
    // Sin número de ticket el título sigue siendo útil, no "undefined".
    expect(buildEntryTicketHtml(ticket({ ticketNumber: null }))).toContain(
      '<title>Ticket · Estacionamiento Apex</title>',
    );
  });

  it('es un documento autocontenido con CSP y ancho de 72mm', () => {
    const html = buildEntryTicketHtml(ticket());
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('Content-Security-Policy');
    expect(html).toContain('width: 72mm');
  });

  it('deja que el nombre envuelva por los espacios', () => {
    // Partir "ESTACIONAMIENTO ONCE" en dos renglones a tamaño completo se lee
    // mejor que forzar uno solo achicando. El achique queda para el caso de
    // una palabra sola que no entra, y lo resuelve main midiendo.
    expect(buildEntryTicketHtml(ticket())).not.toContain('white-space: nowrap');
  });

  it('respeta el ancho de cuerpo del rollo elegido', () => {
    expect(buildEntryTicketHtml(ticket(), { bodyWidthMm: 48 })).toContain(
      'width: 48mm',
    );
  });

  it('se adapta al ancho del driver cuando no hay tamaño declarado', () => {
    const html = buildEntryTicketHtml(ticket(), { bodyWidthMm: null });
    expect(html).toContain('width: 100%');
    expect(html).toContain('max-width: 80mm');
    expect(html).not.toContain('width: 72mm');
  });

  it('escapa texto cargado por el operador', () => {
    const html = buildEntryTicketHtml(
      ticket({ vehicleModel: '<img src=x onerror=alert(1)>' }),
    );
    // El payload sobrevive como texto inerte; lo que importa es que no quede
    // ninguna etiqueta viva ni comilla capaz de cerrar un atributo.
    expect(html).toContain('&lt;img');
    expect(html).not.toContain('<img');
    expect(
      buildEntryTicketHtml(ticket({ color: 'a"onmouseover="x' })),
    ).toContain('&quot;onmouseover=&quot;');
  });

  it('escapa el ampersand antes que las entidades que introduce', () => {
    const html = buildEntryTicketHtml(ticket({ color: 'Blanco & Negro' }));
    expect(html).toContain('Blanco &amp; Negro');
  });

  it('omite la dirección cuando no hay', () => {
    const html = buildEntryTicketHtml(ticket({ parkingAddress: null }));
    expect(html).not.toContain('Balcarce 560');
    expect(html).not.toContain('null');
  });

  it('omite la tarifa y el color cuando faltan', () => {
    const html = buildEntryTicketHtml(
      ticket({ rateNumber: null, color: null }),
    );
    expect(html).not.toContain('Tarifa');
    expect(html).not.toContain('Color');
  });

  it('trata como vacío un valor con solo espacios', () => {
    const html = buildEntryTicketHtml(ticket({ vehicleModel: '   ' }));
    expect(html).not.toContain('Modelo');
  });

  it('marca S/N cuando no hay número de ticket', () => {
    const html = buildEntryTicketHtml(ticket({ ticketNumber: null }));
    expect(html).toContain('S/N');
    expect(html).not.toContain('undefined');
  });

  it('respeta orden, visibilidad y tamaño de la plantilla', () => {
    const html = buildEntryTicketHtml(ticket(), {
      template: {
        version: 1,
        tenantId: 'tenant-1',
        cuitOverride: '',
        grossIncomeText: '',
        nonFiscalControlText: '',
        fields: [
          { id: 'plate', visible: true, fontSizePt: 18, emphasis: 'bold' },
          {
            id: 'parkingName',
            visible: false,
            fontSizePt: 10,
            emphasis: 'normal',
          },
          { id: 'color', visible: true, fontSizePt: 7, emphasis: 'normal' },
        ],
      },
    });

    expect(html.indexOf('ABC123')).toBeLessThan(html.indexOf('Negra'));
    expect(html).toContain('font-size:18pt');
    expect(html).toContain('font-size:7pt');
    expect(html).not.toContain('>Estacionamiento Apex</div>');
  });

  it('usa textos fiscales editables cuando no vienen del perfil', () => {
    const html = buildEntryTicketHtml(ticket({ parkingCuit: null }), {
      template: {
        version: 1,
        tenantId: 'tenant-1',
        cuitOverride: '30-12345678-9',
        grossIncomeText: 'IIBB: 1027025-06',
        nonFiscalControlText: 'Control no fiscal',
        fields: [
          {
            id: 'parkingCuit',
            visible: true,
            fontSizePt: 8,
            emphasis: 'normal',
          },
          {
            id: 'grossIncome',
            visible: true,
            fontSizePt: 8,
            emphasis: 'normal',
          },
          {
            id: 'nonFiscalControl',
            visible: true,
            fontSizePt: 8,
            emphasis: 'normal',
          },
        ],
      },
    });

    expect(html).toContain('CUIT: 30-12345678-9');
    expect(html).toContain('IIBB: 1027025-06');
    expect(html).toContain('Control no fiscal');
  });
});
