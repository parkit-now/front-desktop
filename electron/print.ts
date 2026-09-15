import { BrowserWindow } from 'electron';

export interface PrinterOption {
  name: string;
  displayName: string;
  isDefault: boolean;
}

export type PrintResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | 'no-window'
        | 'no-printer'
        | 'printer-not-found'
        | 'print-failed'
        | 'timeout';
      detail?: string;
    };

/**
 * Some Windows drivers never invoke the `print()` callback. Without this the
 * promise would hang forever and the hidden window would leak.
 */
const PRINT_TIMEOUT_MS = 20_000;
const MAX_HTML_BYTES = 200_000;

// Electron expects `pageSize` in MICRONS. 1in = 25400µm, 1 CSS px = 1/96in.
const TICKET_WIDTH_MICRONS = 80_000; // 80mm roll
const MIN_HEIGHT_MICRONS = 40_000;
const MICRONS_PER_MM = 1_000;
const DEFAULT_TAIL_FEED_MM = 10;
const MAX_TAIL_FEED_MM = 30;
const MICRONS_PER_CSS_PX = 25_400 / 96;
const TICKET_WIDTH_PX = 303; // 80mm at 96dpi, so the measured height matches print layout

const livePrintWindows = new Set<BrowserWindow>();

/** Serializes jobs: two fast entries must not race the same printer. */
let jobQueue: Promise<unknown> = Promise.resolve();

export async function listPrinters(
  host: BrowserWindow | null,
): Promise<PrinterOption[]> {
  if (!host || host.isDestroyed()) return [];
  try {
    const printers = await host.webContents.getPrintersAsync();
    return printers.map((printer) => ({
      name: printer.name,
      displayName: printer.displayName || printer.name,
      isDefault: printer.isDefault,
    }));
  } catch {
    // No print subsystem at all (e.g. a Linux box without CUPS).
    return [];
  }
}

export interface PrintPayload {
  html: string;
  deviceName: string | null;
  /**
   * Papel extra tras la última línea. Configurable por equipo: una térmica con
   * guillotina lo necesita para no cortar sobre el texto; a PDF es desperdicio.
   */
  tailFeedMm?: number;
}

export function printTicketHtml(
  host: BrowserWindow | null,
  payload: PrintPayload,
): Promise<PrintResult> {
  const run = jobQueue.then(
    () => runPrintJob(host, payload),
    () => runPrintJob(host, payload),
  );
  jobQueue = run.catch(() => undefined);
  return run;
}

async function runPrintJob(
  host: BrowserWindow | null,
  payload: PrintPayload,
): Promise<PrintResult> {
  if (!host || host.isDestroyed()) return { ok: false, reason: 'no-window' };
  if (
    typeof payload?.html !== 'string' ||
    payload.html.length > MAX_HTML_BYTES
  ) {
    return { ok: false, reason: 'print-failed', detail: 'invalid payload' };
  }

  // Resolve the device BEFORE opening a window, so a stale saved printer fails
  // fast instead of spawning a window that can never print.
  const printers = await listPrinters(host);
  if (printers.length === 0) return { ok: false, reason: 'no-printer' };

  const target = payload.deviceName
    ? printers.find((printer) => printer.name === payload.deviceName)
    : (printers.find((printer) => printer.isDefault) ?? printers[0]);
  if (!target) {
    return {
      ok: false,
      reason: 'printer-not-found',
      detail: payload.deviceName ?? undefined,
    };
  }

  const win = new BrowserWindow({
    show: false,
    width: TICKET_WIDTH_PX,
    height: 1200,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      // Hidden windows are throttled by default, which stalls the print layout.
      backgroundThrottling: false,
      // Deliberately no preload: the ticket document gets zero bridge surface.
    },
  });
  livePrintWindows.add(win);

  try {
    await win.loadURL(
      'data:text/html;charset=utf-8,' + encodeURIComponent(payload.html),
    );

    // Measure so the receipt is exactly as long as its content: on continuous
    // paper an oversized page wastes a hand of roll per car.
    const measured: unknown = await win.webContents
      .executeJavaScript('document.body.scrollHeight')
      .catch(() => 0);
    // Se sanea acá y no solo en el renderer: main no puede confiar en que el
    // payload venga bien formado, y un NaN acá imprimiría una hoja absurda.
    const requestedFeed = Number(payload.tailFeedMm);
    const tailFeedMm = Number.isFinite(requestedFeed)
      ? Math.min(Math.max(requestedFeed, 0), MAX_TAIL_FEED_MM)
      : DEFAULT_TAIL_FEED_MM;

    const height = Math.max(
      MIN_HEIGHT_MICRONS,
      Math.round(Number(measured) * MICRONS_PER_CSS_PX) +
        Math.round(tailFeedMm * MICRONS_PER_MM),
    );

    return await new Promise<PrintResult>((resolve) => {
      const timer = setTimeout(
        () => resolve({ ok: false, reason: 'timeout' }),
        PRINT_TIMEOUT_MS,
      );
      win.webContents.print(
        {
          silent: true,
          deviceName: target.name,
          printBackground: true,
          margins: { marginType: 'none' },
          pageSize: { width: TICKET_WIDTH_MICRONS, height },
          copies: 1,
        },
        (success, failureReason) => {
          clearTimeout(timer);
          resolve(
            success
              ? { ok: true }
              : { ok: false, reason: 'print-failed', detail: failureReason },
          );
        },
      );
    });
  } catch (error) {
    return { ok: false, reason: 'print-failed', detail: String(error) };
  } finally {
    livePrintWindows.delete(win);
    // Never destroy before the callback resolves: that cancels the spooled job.
    if (!win.isDestroyed()) win.destroy();
  }
}

/** A hidden window that outlived its job would keep the app from quitting. */
export function destroyPrintWindows(): void {
  for (const win of livePrintWindows) {
    if (!win.isDestroyed()) win.destroy();
  }
  livePrintWindows.clear();
}
