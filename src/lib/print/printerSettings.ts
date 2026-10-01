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

export type PaperSize = 'roll80' | 'roll58' | 'driver' | 'custom';

export const DEFAULT_PAPER_SIZE: PaperSize = 'roll80';
export const DEFAULT_CUSTOM_MEDIA_WIDTH_MM = 80;
export const DEFAULT_CUSTOM_BODY_WIDTH_MM = 72;
const MIN_PAPER_WIDTH_MM = 20;
const MAX_PAPER_WIDTH_MM = 210;

export interface ResolvedPaperSize {
  label: string;
  /** Ancho físico que se manda a Electron/driver. */
  mediaWidthMm: number | null;
  /** Ancho útil del HTML del ticket. */
  bodyWidthMm: number | null;
}

export const PAPER_SIZES: Record<PaperSize, ResolvedPaperSize> = {
  roll80: {
    label: '80 mm (rollo estándar)',
    mediaWidthMm: 80,
    bodyWidthMm: 72,
  },
  roll58: {
    label: '58 mm (rollo angosto)',
    mediaWidthMm: 58,
    bodyWidthMm: 48,
  },
  driver: {
    label: 'Driver (avanzado)',
    mediaWidthMm: null,
    bodyWidthMm: null,
  },
  custom: {
    label: 'Personalizado',
    mediaWidthMm: DEFAULT_CUSTOM_MEDIA_WIDTH_MM,
    bodyWidthMm: DEFAULT_CUSTOM_BODY_WIDTH_MM,
  },
};

export interface PrinterSettings {
  version: 4;
  /** `null` = use whatever the OS considers the default printer. */
  deviceName: string | null;
  tailFeedMm: number;
  paperSize: PaperSize;
  customMediaWidthMm: number;
  customBodyWidthMm: number;
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
  paperSize: z
    .enum(['roll80', 'roll58', 'driver', 'custom'])
    .optional()
    .catch(undefined),
  customMediaWidthMm: z
    .number()
    .min(MIN_PAPER_WIDTH_MM)
    .max(MAX_PAPER_WIDTH_MM)
    .optional()
    .catch(undefined),
  customBodyWidthMm: z
    .number()
    .min(MIN_PAPER_WIDTH_MM)
    .max(MAX_PAPER_WIDTH_MM)
    .optional()
    .catch(undefined),
});

export function defaultPrinterSettings(): PrinterSettings {
  return {
    version: 4,
    deviceName: null,
    tailFeedMm: DEFAULT_TAIL_FEED_MM,
    paperSize: DEFAULT_PAPER_SIZE,
    customMediaWidthMm: DEFAULT_CUSTOM_MEDIA_WIDTH_MM,
    customBodyWidthMm: DEFAULT_CUSTOM_BODY_WIDTH_MM,
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
    const customMediaWidthMm =
      parsed.data.customMediaWidthMm ?? defaults.customMediaWidthMm;
    const customBodyWidthMm = clampPaperWidth(
      parsed.data.customBodyWidthMm ?? defaults.customBodyWidthMm,
      customMediaWidthMm,
    );
    return {
      version: 4,
      deviceName: parsed.data.deviceName ?? defaults.deviceName,
      tailFeedMm: parsed.data.tailFeedMm ?? defaults.tailFeedMm,
      paperSize: parsed.data.paperSize ?? defaults.paperSize,
      customMediaWidthMm,
      customBodyWidthMm,
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

function clampPaperWidth(value: number, max = MAX_PAPER_WIDTH_MM): number {
  const rounded = Math.round(value);
  return Math.min(Math.max(rounded, MIN_PAPER_WIDTH_MM), max);
}

export function setCustomPaperSize(
  input: { mediaWidthMm: number; bodyWidthMm: number },
  storage: PrinterStorage | null = getBrowserStorage(),
): PrinterSettings {
  const mediaWidthMm = clampPaperWidth(input.mediaWidthMm);
  const bodyWidthMm = clampPaperWidth(input.bodyWidthMm, mediaWidthMm);
  const next: PrinterSettings = {
    ...readPrinterSettings(storage),
    paperSize: 'custom',
    customMediaWidthMm: mediaWidthMm,
    customBodyWidthMm: bodyWidthMm,
  };
  writePrinterSettings(next, storage);
  return next;
}

export function resolvePaperSize(
  settings: Pick<
    PrinterSettings,
    'paperSize' | 'customMediaWidthMm' | 'customBodyWidthMm'
  >,
): ResolvedPaperSize {
  if (settings.paperSize === 'custom') {
    const mediaWidthMm = clampPaperWidth(settings.customMediaWidthMm);
    return {
      label: PAPER_SIZES.custom.label,
      mediaWidthMm,
      bodyWidthMm: clampPaperWidth(settings.customBodyWidthMm, mediaWidthMm),
    };
  }

  const preset = PAPER_SIZES[settings.paperSize];
  return {
    label: preset.label,
    mediaWidthMm: preset.mediaWidthMm,
    bodyWidthMm: preset.bodyWidthMm,
  };
}
