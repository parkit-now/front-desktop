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
    vehicle: 'VW Suran',
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
    expect(html).toContain('VW Suran');
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

  it('escapa texto cargado por el operador', () => {
    const html = buildEntryTicketHtml(
      ticket({ vehicle: '<img src=x onerror=alert(1)>' }),
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
    // `.t-addr` vive siempre en la hoja de estilos: lo que no debe existir es
    // el div renderizado.
    expect(html).not.toContain('<div class="t-addr">');
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
    const html = buildEntryTicketHtml(ticket({ vehicle: '   ' }));
    expect(html).not.toContain('Vehículo');
  });

  it('marca S/N cuando no hay número de ticket', () => {
    const html = buildEntryTicketHtml(ticket({ ticketNumber: null }));
    expect(html).toContain('S/N');
    expect(html).toContain('t-ticket-number--missing');
    expect(html).not.toContain('undefined');
  });
});
