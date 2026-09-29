import { BrowserWindow } from 'electron';

export type RenderPdfResult =
  | { ok: true; data: Uint8Array }
  | { ok: false; reason: 'invalid-payload' | 'render-failed'; detail?: string };

/** Una factura A4 son ~20 KB de HTML más el QR; esto sobra y corta abusos. */
const MAX_HTML_BYTES = 500_000;
const RENDER_TIMEOUT_MS = 20_000;

/** Márgenes de la plantilla de ARCA (en pulgadas: 10 mm y 18 mm abajo). */
const MARGIN_IN = 10 / 25.4;
const MARGIN_BOTTOM_IN = 18 / 25.4;

/**
 * Empuja el bloque de totales + CAE al pie de la última página, como la
 * plantilla de `@arcasdk/pdf`: un spacer en vez de `margin-top`, porque el
 * margen se anula al principio de una página impresa.
 */
const PIN_SUMMARY_SCRIPT = `(() => {
  const summary = document.querySelector('.summary-final');
  if (!summary) return;
  summary.style.marginTop = '0';
  const printable = Math.floor(((297 - 10 - 18) * 96) / 25.4);
  const rect = summary.getBoundingClientRect();
  if (rect.height >= printable) return;
  const end = rect.top + window.scrollY + rect.height;
  const push = Math.max(0, Math.floor(Math.ceil(end / printable) * printable - end) - 5);
  if (push > 1) {
    const spacer = document.createElement('div');
    spacer.style.height = push + 'px';
    summary.parentNode.insertBefore(spacer, summary);
  }
})()`;

const FOOTER_TEMPLATE = `
  <div style="font-size: 9px; width: 100%; text-align: center; padding: 0 10mm; box-sizing: border-box; border-top: 1px solid #000;">
    <span style="float: right; padding-top: 3px; margin-right: 10mm;">Pág. <span class="pageNumber"></span>/<span class="totalPages"></span></span>
    <div style="clear: both;"></div>
  </div>`;

const livePdfWindows = new Set<BrowserWindow>();

/**
 * Pasa a PDF A4 el HTML del comprobante de una factura (lo arma el renderer,
 * ver `invoiceDocument.ts`) con el Chromium de Electron, en una ventana
 * oculta y sin preload: el documento no tiene ningún acceso al bridge.
 */
export async function renderPdfFromHtml(
  html: unknown,
): Promise<RenderPdfResult> {
  if (typeof html !== 'string' || html.length > MAX_HTML_BYTES) {
    return { ok: false, reason: 'invalid-payload' };
  }

  // A4 a 96 dpi menos los márgenes: el mismo ancho que va a tener impreso.
  const win = new BrowserWindow({
    show: false,
    width: Math.round(((210 - 20) * 96) / 25.4),
    height: 1200,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  livePdfWindows.add(win);

  let timer: NodeJS.Timeout | undefined;
  try {
    const render = (async () => {
      await win.loadURL(
        'data:text/html;charset=utf-8,' + encodeURIComponent(html),
      );
      await win.webContents
        .executeJavaScript(PIN_SUMMARY_SCRIPT)
        .catch(() => null);
      return win.webContents.printToPDF({
        pageSize: 'A4',
        printBackground: true,
        displayHeaderFooter: true,
        headerTemplate: '<span></span>',
        footerTemplate: FOOTER_TEMPLATE,
        margins: {
          top: MARGIN_IN,
          left: MARGIN_IN,
          right: MARGIN_IN,
          bottom: MARGIN_BOTTOM_IN,
        },
      });
    })();
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('timeout')), RENDER_TIMEOUT_MS);
    });
    const pdf = await Promise.race([render, timeout]);
    return { ok: true, data: new Uint8Array(pdf) };
  } catch (error) {
    return {
      ok: false,
      reason: 'render-failed',
      detail: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
    livePdfWindows.delete(win);
    if (!win.isDestroyed()) win.destroy();
  }
}

/** Una ventana oculta que sobrevive a su PDF no deja cerrar la app. */
export function destroyPdfWindows(): void {
  for (const win of livePdfWindows) {
    if (!win.isDestroyed()) win.destroy();
  }
  livePdfWindows.clear();
}
