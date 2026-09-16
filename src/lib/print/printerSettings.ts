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

export type PaperSize = 'roll80' | 'roll58' | 'driver';

export const DEFAULT_PAPER_SIZE: PaperSize = 'roll80';

export const PAPER_SIZES: Record<
  PaperSize,
  { label: string; pageWidthMm: number | null; bodyWidthMm: number | null }
> = {
  roll80: {
    label: '80 mm (rollo estándar)',
    pageWidthMm: 72,
    bodyWidthMm: 72,
  },
  roll58: {
    label: '58 mm (rollo angosto)',
    pageWidthMm: 48,
    bodyWidthMm: 48,
  },
  driver: {
    label: 'Usar el tamaño configurado en el driver',
    pageWidthMm: null,
    bodyWidthMm: null,
  },
};

export interface PrinterSettings {
  version: 3;
  /** `null` = use whatever the OS considers the default printer. */
  deviceName: string | null;
  tailFeedMm: number;
  paperSize: PaperSize;
}

const StoredSchema = z.object({
  deviceName: z.string().min(1).nullable().optional().catch(undefined),
  tailFeedMm: z
    .number()
    .int()
    .min(0)
    .max(MAX_TAIL_FEED_MM)
    .optional()
    .catch(undefined),
  paperSize: z.enum(['roll80', 'roll58', 'driver']).optional().catch(undefined),
});

export function defaultPrinterSettings(): PrinterSettings {
  return {
    version: 3,
    deviceName: null,
    tailFeedMm: DEFAULT_TAIL_FEED_MM,
    paperSize: DEFAULT_PAPER_SIZE,
  };
}

function getBrowserStorage(): PrinterStorage | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage;
}

/** Never throws: corrupt storage falls back to defaults so printing still works. */
export function readPrinterSettings(
  storage: PrinterStorage | null = getBrowserStorage(),
): PrinterSettings {
  const defaults = defaultPrinterSettings();
  if (!storage) return defaults;

  const raw = storage.getItem(STORAGE_KEY);
  if (!raw) return defaults;

  try {
    const parsed = StoredSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return defaults;
    return {
      version: 3,
      deviceName: parsed.data.deviceName ?? defaults.deviceName,
      tailFeedMm: parsed.data.tailFeedMm ?? defaults.tailFeedMm,
      paperSize: parsed.data.paperSize ?? defaults.paperSize,
    };
  } catch {
    return defaults;
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
    tailFeedMm: clamped,
  };
  writePrinterSettings(next, storage);
  return next;
}

export function setPaperSize(
  paperSize: PaperSize,
  storage: PrinterStorage | null = getBrowserStorage(),
): PrinterSettings {
  const next: PrinterSettings = {
    ...readPrinterSettings(storage),
    paperSize,
  };
  writePrinterSettings(next, storage);
  return next;
}
