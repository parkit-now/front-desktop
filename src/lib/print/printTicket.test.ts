import { describe, expect, it, vi } from 'vitest';
import type { EntryTicketData } from './entryTicket';
import { describePrintFailure, printEntryTicket } from './printTicket';

const data: EntryTicketData = {
  parkingName: 'Estacionamiento Apex',
  parkingAddress: 'Balcarce 560',
  plate: 'ABC123',
  vehicleBrand: 'VW',
  vehicleModel: 'Suran',
  color: 'Negra',
  enteredAt: new Date(2026, 8, 14, 13, 43).toISOString(),
  rateNumber: 2,
  ticketNumber: 5,
};

type Bridge = NonNullable<Window['parkitDesktop']>;

function bridgeWith(printTicket: Bridge['printTicket']): Bridge {
  return { printTicket } as unknown as Bridge;
}

describe('printEntryTicket', () => {
  it('avisa cuando no está el puente de Electron', async () => {
    await expect(printEntryTicket(data, null, undefined)).resolves.toEqual({
      ok: false,
      reason: 'no-bridge',
    });
  });

  it('manda el ticket armado y devuelve el resultado del puente', async () => {
    const printTicket = vi.fn().mockResolvedValue({ ok: true });
    await expect(
      printEntryTicket(data, 'tenant-1', bridgeWith(printTicket)),
    ).resolves.toEqual({ ok: true });

    const payload = printTicket.mock.calls[0][0] as {
      html: string;
      pageWidthMm: number | null;
    };
    expect(payload.html).toContain('ABC123');
    expect(payload.html).toContain('VW');
    expect(payload.html).toContain('Suran');
    expect(payload.html).toContain('Estacionamiento Apex');
    // Default = rollo de 80mm, que declara el ANCHO IMPRIMIBLE (72), no el del
    // papel: declarar 80 dejaba el contenido en la franja no imprimible.
    expect(payload.pageWidthMm).toBe(72);
    expect(payload.html).toContain('width: 72mm');
  });

  it('no rechaza nunca: un puente que falla resuelve un outcome', async () => {
    const printTicket = vi.fn().mockRejectedValue(new Error('spooler caído'));
    await expect(
      printEntryTicket(data, 'tenant-1', bridgeWith(printTicket)),
    ).resolves.toMatchObject({ ok: false, reason: 'print-failed' });
  });
});

describe('describePrintFailure', () => {
  it('no dice nada cuando salió bien', () => {
    expect(describePrintFailure({ ok: true })).toBe('');
  });

  it('siempre aclara que el ingreso quedó registrado', () => {
    const reasons = [
      'no-printer',
      'printer-not-found',
      'timeout',
      'print-failed',
    ] as const;
    for (const reason of reasons) {
      expect(describePrintFailure({ ok: false, reason })).toContain(
        'se registró igual',
      );
    }
  });

  it('da un mensaje para cada motivo posible', () => {
    const reasons = [
      'no-bridge',
      'no-window',
      'no-printer',
      'printer-not-found',
      'timeout',
      'print-failed',
    ] as const;
    for (const reason of reasons) {
      expect(
        describePrintFailure({ ok: false, reason }).length,
      ).toBeGreaterThan(0);
    }
  });
});
