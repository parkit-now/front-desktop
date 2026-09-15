import { z } from 'zod';

export type PrinterStorage = Pick<
  Storage,
  'getItem' | 'setItem' | 'removeItem'
>;

/**
 * Not scoped by user or tenant: which printer is attached is a property of this
 * machine, not of who is logged in or which lot they operate.
 */
const STORAGE_KEY = 'parkit.desktop.printer';

/**
 * Papel que se alimenta después de la última línea, en milímetros.
 *
 * En una térmica con guillotina la cuchilla está ~10-15mm por encima del
 * cabezal: sin avance, el corte cae sobre el texto. En una impresora sin
 * guillotina, o cuando se imprime a PDF, es blanco desperdiciado. Depende del
 * hardware, así que se configura por equipo.
 */
export const TAIL_FEED_OPTIONS_MM = [0, 5, 10, 15] as const;
export const DEFAULT_TAIL_FEED_MM = 10;
const MAX_TAIL_FEED_MM = 30;

const PrinterSettingsV1Schema = z.object({
  version: z.literal(1),
  deviceName: z.string().min(1).nullable(),
});

export const PrinterSettingsSchema = z.object({
  version: z.literal(2),
  /** `null` = use whatever the OS considers the default printer. */
  deviceName: z.string().min(1).nullable(),
  tailFeedMm: z.number().int().min(0).max(MAX_TAIL_FEED_MM),
});

export type PrinterSettings = z.infer<typeof PrinterSettingsSchema>;

export function defaultPrinterSettings(): PrinterSettings {
  return { version: 2, deviceName: null, tailFeedMm: DEFAULT_TAIL_FEED_MM };
}

function getBrowserStorage(): PrinterStorage | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage;
}

/**
 * Never throws: corrupt storage falls back to defaults so printing still works.
 * A v1 blob is upgraded in place instead of discarded — perder la impresora ya
 * elegida por haber agregado un campo sería una regresión silenciosa.
 */
export function readPrinterSettings(
  storage: PrinterStorage | null = getBrowserStorage(),
): PrinterSettings {
  if (!storage) return defaultPrinterSettings();

  const raw = storage.getItem(STORAGE_KEY);
  if (!raw) return defaultPrinterSettings();

  try {
    const parsed: unknown = JSON.parse(raw);

    const current = PrinterSettingsSchema.safeParse(parsed);
    if (current.success) return current.data;

    const legacy = PrinterSettingsV1Schema.safeParse(parsed);
    if (legacy.success) {
      return {
        version: 2,
        deviceName: legacy.data.deviceName,
        tailFeedMm: DEFAULT_TAIL_FEED_MM,
      };
    }

    return defaultPrinterSettings();
  } catch {
    return defaultPrinterSettings();
  }
}

export function writePrinterSettings(
  next: PrinterSettings,
  storage: PrinterStorage | null = getBrowserStorage(),
): void {
  if (!storage) return;
  storage.setItem(STORAGE_KEY, JSON.stringify(next));
}

export function setSelectedPrinter(
  deviceName: string | null,
  storage: PrinterStorage | null = getBrowserStorage(),
): PrinterSettings {
  const next: PrinterSettings = {
    ...readPrinterSettings(storage),
    version: 2,
    deviceName: deviceName || null,
  };
  writePrinterSettings(next, storage);
  return next;
}

export function setTailFeedMm(
  tailFeedMm: number,
  storage: PrinterStorage | null = getBrowserStorage(),
): PrinterSettings {
  const clamped = Math.min(
    Math.max(Math.round(tailFeedMm), 0),
    MAX_TAIL_FEED_MM,
  );
  const next: PrinterSettings = {
    ...readPrinterSettings(storage),
    version: 2,
    tailFeedMm: clamped,
  };
  writePrinterSettings(next, storage);
  return next;
}
