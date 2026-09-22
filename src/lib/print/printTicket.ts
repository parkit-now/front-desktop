import { buildEntryTicketHtml, type EntryTicketData } from './entryTicket';
import { PAPER_SIZES, readPrinterSettings } from './printerSettings';
import { readTicketTemplateSettings } from './ticketTemplate';

type PrintBridge = NonNullable<Window['parkitDesktop']>;

export type PrintOutcome =
  | DesktopPrintResult
  | { ok: false; reason: 'no-bridge' };

function resolveBridge(): PrintBridge | undefined {
  if (typeof window === 'undefined') return undefined;
  return window.parkitDesktop;
}

/**
 * Best-effort silent print of an entry ticket.
 *
 * NEVER rejects: every failure resolves a discriminated outcome. Callers fire
 * this without awaiting it, so a rejection would surface as an unhandled
 * promise rejection instead of a toast — and, worse, a print problem would be
 * indistinguishable from the entry itself failing.
 *
 * `bridge` is injectable because the suite runs in node, where `window` is
 * undefined.
 */
export async function printEntryTicket(
  data: EntryTicketData,
  tenantId?: string | null,
  bridge: PrintBridge | undefined = resolveBridge(),
): Promise<PrintOutcome> {
  if (!bridge || typeof bridge.printTicket !== 'function') {
    return { ok: false, reason: 'no-bridge' };
  }
  try {
    const settings = readPrinterSettings();
    const template = readTicketTemplateSettings(tenantId ?? 'default');
    const { pageWidthMm, bodyWidthMm } = PAPER_SIZES[settings.paperSize];
    return await bridge.printTicket({
      html: buildEntryTicketHtml(data, { bodyWidthMm, template }),
      deviceName: settings.deviceName,
      tailFeedMm: settings.tailFeedMm,
      pageWidthMm,
    });
  } catch (error) {
    return { ok: false, reason: 'print-failed', detail: String(error) };
  }
}

/**
 * Operator-facing copy. Every message states that the entry was saved: the
 * operator must never read a print failure as a lost vehicle.
 */
export function describePrintFailure(outcome: PrintOutcome): string {
  if (outcome.ok) return '';
  switch (outcome.reason) {
    case 'no-bridge':
    case 'no-window':
      return 'La impresión solo está disponible en la app de escritorio.';
    case 'no-printer':
      return 'No hay impresoras instaladas. El ingreso se registró igual.';
    case 'printer-not-found':
      return 'La impresora configurada no está disponible. Elegí otra en Impresora. El ingreso se registró igual.';
    case 'timeout':
      return 'La impresora no respondió. El ingreso se registró igual.';
    default:
      return 'No se pudo imprimir el ticket. El ingreso se registró igual.';
  }
}
