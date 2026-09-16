import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PAPER_SIZE,
  DEFAULT_TAIL_FEED_MM,
  defaultPrinterSettings,
  readPrinterSettings,
  setPaperSize,
  setSelectedPrinter,
  setTailFeedMm,
  writePrinterSettings,
} from './printerSettings';

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

describe('printerSettings', () => {
  it('devuelve el default cuando no hay nada guardado', () => {
    expect(readPrinterSettings(new MemoryStorage())).toEqual(
      defaultPrinterSettings(),
    );
  });

  it('hace round-trip de la impresora elegida', () => {
    const storage = new MemoryStorage();
    setSelectedPrinter('EPSON-TM-T20', storage);
    expect(readPrinterSettings(storage).deviceName).toBe('EPSON-TM-T20');
  });

  it('migra un blob v1 sin perder la impresora ya elegida', () => {
    const storage = new MemoryStorage();
    storage.setItem(
      'parkit.desktop.printer',
      JSON.stringify({ version: 1, deviceName: 'EPSON-TM-T20' }),
    );
    const migrated = readPrinterSettings(storage);
    expect(migrated.version).toBe(3);
    expect(migrated.deviceName).toBe('EPSON-TM-T20');
    expect(migrated.tailFeedMm).toBe(DEFAULT_TAIL_FEED_MM);
    expect(migrated.paperSize).toBe(DEFAULT_PAPER_SIZE);
  });

  it('migra un blob v2 conservando impresora y avance', () => {
    const storage = new MemoryStorage();
    storage.setItem(
      'parkit.desktop.printer',
      JSON.stringify({ version: 2, deviceName: 'TP85', tailFeedMm: 0 }),
    );
    expect(readPrinterSettings(storage)).toMatchObject({
      version: 3,
      deviceName: 'TP85',
      tailFeedMm: 0,
      paperSize: DEFAULT_PAPER_SIZE,
    });
  });

  it('guarda el tamaño de papel sin pisar impresora ni avance', () => {
    const storage = new MemoryStorage();
    setSelectedPrinter('TP85', storage);
    setTailFeedMm(0, storage);
    setPaperSize('roll58', storage);
    expect(readPrinterSettings(storage)).toMatchObject({
      deviceName: 'TP85',
      tailFeedMm: 0,
      paperSize: 'roll58',
    });
  });

  it('un tamaño de papel desconocido cae al default', () => {
    const storage = new MemoryStorage();
    storage.setItem(
      'parkit.desktop.printer',
      JSON.stringify({ version: 3, deviceName: 'TP85', paperSize: 'roll99' }),
    );
    const read = readPrinterSettings(storage);
    expect(read.paperSize).toBe(DEFAULT_PAPER_SIZE);
    // Lo importante: un campo inválido no puede arrastrar a los demás.
    expect(read.deviceName).toBe('TP85');
  });

  it('guarda el avance sin pisar la impresora, y al revés', () => {
    const storage = new MemoryStorage();
    setSelectedPrinter('PDF', storage);
    setTailFeedMm(0, storage);
    expect(readPrinterSettings(storage)).toMatchObject({
      deviceName: 'PDF',
      tailFeedMm: 0,
    });
    setSelectedPrinter('EPSON-TM-T20', storage);
    expect(readPrinterSettings(storage).tailFeedMm).toBe(0);
  });

  it('acota el avance a un rango sensato', () => {
    const storage = new MemoryStorage();
    expect(setTailFeedMm(-5, storage).tailFeedMm).toBe(0);
    expect(setTailFeedMm(999, storage).tailFeedMm).toBe(30);
    expect(setTailFeedMm(7.6, storage).tailFeedMm).toBe(8);
  });

  it('no explota con JSON corrupto', () => {
    const storage = new MemoryStorage();
    storage.setItem('parkit.desktop.printer', '{{{');
    expect(readPrinterSettings(storage)).toEqual(defaultPrinterSettings());
  });

  it('ignora un blob con shape inválido', () => {
    const storage = new MemoryStorage();
    storage.setItem(
      'parkit.desktop.printer',
      JSON.stringify({ version: 3, deviceName: 42 }),
    );
    expect(readPrinterSettings(storage)).toEqual(defaultPrinterSettings());
  });

  it('rechaza un nombre de impresora vacío', () => {
    const storage = new MemoryStorage();
    storage.setItem(
      'parkit.desktop.printer',
      JSON.stringify({ version: 3, deviceName: '', tailFeedMm: 10 }),
    );
    expect(readPrinterSettings(storage)).toEqual(defaultPrinterSettings());
  });

  it('sin storage lee el default y escribir es un no-op', () => {
    expect(readPrinterSettings(null)).toEqual(defaultPrinterSettings());
    expect(() =>
      writePrinterSettings(
        { version: 3, deviceName: 'X', tailFeedMm: 10, paperSize: 'roll80' },
        null,
      ),
    ).not.toThrow();
  });

  it('setSelectedPrinter vuelve al default del sistema con null', () => {
    const storage = new MemoryStorage();
    setSelectedPrinter('EPSON-TM-T20', storage);
    expect(setSelectedPrinter(null, storage).deviceName).toBeNull();
    expect(readPrinterSettings(storage).deviceName).toBeNull();
  });
});
