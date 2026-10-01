import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EntryTicketData } from './entryTicket';
import { describePrintFailure, printEntryTicket } from './printTicket';
import { setCustomPaperSize, setPaperSize } from './printerSettings';

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

function bridgeWith(printTicket: Bridge['printTicket']): Bridge {
  return { printTicket } as unknown as Bridge;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

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
      mediaWidthMm: number | null;
      bodyWidthMm: number | null;
      debugDialog?: boolean;
    };
    expect(payload.html).toContain('ABC123');
    expect(payload.html).toContain('VW');
    expect(payload.html).toContain('Suran');
    expect(payload.html).toContain('Estacionamiento Apex');
    expect(payload.mediaWidthMm).toBe(80);
    expect(payload.bodyWidthMm).toBe(72);
    expect(payload.debugDialog).toBeUndefined();
    expect(payload.html).toContain('width: 72mm');
  });

  it('no manda tamaño explícito cuando se elige driver', async () => {
    const storage = new MemoryStorage();
    setPaperSize('driver', storage);
    vi.stubGlobal('window', { localStorage: storage });
    const printTicket = vi.fn().mockResolvedValue({ ok: true });

    await expect(
      printEntryTicket(data, 'tenant-1', bridgeWith(printTicket)),
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

  it('manda el tamaño personalizado guardado', async () => {
    const storage = new MemoryStorage();
    setCustomPaperSize({ mediaWidthMm: 76, bodyWidthMm: 68 }, storage);
    vi.stubGlobal('window', { localStorage: storage });
    const printTicket = vi.fn().mockResolvedValue({ ok: true });

    await expect(
      printEntryTicket(data, 'tenant-1', bridgeWith(printTicket)),
    ).resolves.toEqual({ ok: true });

    const payload = printTicket.mock.calls[0][0] as {
      html: string;
      mediaWidthMm: number | null;
      bodyWidthMm: number | null;
    };
    expect(payload.mediaWidthMm).toBe(76);
    expect(payload.bodyWidthMm).toBe(68);
    expect(payload.html).toContain('width: 68mm');
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
