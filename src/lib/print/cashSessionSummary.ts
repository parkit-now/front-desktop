import { formatArs, formatArgentinaDateTime } from '../format/argentina';
import type { SessionSummary } from '../../features/cash-session/cashSessionUtils';
import { escapeHtml } from './html';
import { readPrinterSettings, resolvePaperSize } from './printerSettings';
import type { ReceiptPrintOutcome } from './receipt';
import {
  defaultCashSessionTemplateSettings,
  readCashSessionTemplateSettings,
  type CashSessionTemplateField,
  type CashSessionTemplateSettings,
} from './cashSessionTemplate';

type PrintBridge = NonNullable<Window['parkitDesktop']>;

export interface CashSessionPrintData {
  tenantId?: string | null;
  parkingName?: string | null;
  openedAt: string;
  closedAt: string;
  summary: SessionSummary;
  leavingCash?: number | null;
  notes?: string | null;
}

export function buildCashSessionSummaryHtml(
  data: CashSessionPrintData,
  bodyWidthMm: number | null = 72,
  template: CashSessionTemplateSettings = defaultCashSessionTemplateSettings(
    data.tenantId,
  ),
): string {
  const bodyWidthCss =
    bodyWidthMm === null
      ? 'width: 100%; max-width: 72mm; margin: 0;'
      : `width: ${bodyWidthMm}mm; margin: 0 auto;`;
  function row(label: string, value: string): string {
    return `<div class="row"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
  }

  function renderField(field: CashSessionTemplateField): string {
    if (!field.visible) return '';
    const style = `font-size:${field.fontSizePt}pt;font-weight:${field.emphasis === 'bold' ? 800 : 400};`;
    switch (field.id) {
      case 'parkingName':
        return data.parkingName?.trim()
          ? `<div class="parking" style="${style}">${escapeHtml(data.parkingName.trim())}</div>`
          : '';
      case 'title':
        return `<div class="title" style="${style}">Cierre de caja</div>`;
      case 'openedAt':
        return `<div style="${style}">${row('Apertura', formatArgentinaDateTime(data.openedAt))}</div>`;
      case 'closedAt':
        return `<div style="${style}">${row('Cierre', formatArgentinaDateTime(data.closedAt))}</div>`;
      case 'paymentMethods':
        return `<div class="section payment-methods" style="${style}"><div class="section-label">Cobros por medio de pago</div>${
          data.summary.byPm.length
            ? data.summary.byPm
                .map((pm) => row(pm.pmName, formatArs(pm.total)))
                .join('')
            : 'Sin movimientos en este turno.'
        }</div>`;
      case 'grandTotal':
        return `<div class="section total" style="${style}">${row('Total cobrado', formatArs(data.summary.grandTotal))}</div>`;
      case 'transactionCount':
        return `<div style="${style}">${row('Cantidad de pagos', String(data.summary.txCount))}</div>`;
      case 'openingCash':
        return `<div style="${style}">${row('Fondo inicial', formatArs(data.summary.openingCash))}</div>`;
      case 'cashTotal':
        return `<div style="${style}">${row('Efectivo en caja', formatArs(data.summary.cashTotal))}</div>`;
      case 'leavingCash':
        return data.leavingCash != null
          ? `<div style="${style}">${row('Fondo para siguiente turno', formatArs(data.leavingCash))}</div>`
          : '';
      case 'notes':
        return data.notes?.trim()
          ? `<div class="section notes" style="${style}"><strong>Notas</strong><br />${escapeHtml(data.notes.trim())}</div>`
          : '';
    }
  }

  const rendered = template.fields
    .map(renderField)
    .filter(Boolean)
    .join('\n  ');

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<title>Resumen de cierre de caja</title>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';" />
<style>
  @page { margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; }
  body {
    ${bodyWidthCss}
    padding: 1mm 0 2mm;
    color: #000;
    font-family: "Segoe UI", "DejaVu Sans", Arial, sans-serif;
    font-size: 9pt;
    line-height: 1.25;
  }
  .title { margin: 0 0 2mm; text-align: center; }
  .parking { margin-bottom: 2mm; text-align: center; overflow-wrap: anywhere; }
  .row { display: flex; justify-content: space-between; gap: 2mm; margin: 1mm 0; }
  .row span { min-width: 0; overflow-wrap: anywhere; }
  .row strong { text-align: right; white-space: nowrap; }
  .section { border-top: 1px dashed #000; margin-top: 2mm; padding-top: 1mm; }
  .section-label { margin: 0 0 1mm; font-size: .85em; font-weight: 700; text-transform: uppercase; }
  .payment-methods .row { margin: 0; padding: .7mm 0; }
  .payment-methods .row + .row { border-top: 1px dotted #777; }
  .notes { overflow-wrap: anywhere; white-space: pre-wrap; }
</style>
</head>
<body>
  ${rendered}
</body>
</html>`;
}

export async function printCashSessionSummary(
  data: CashSessionPrintData,
  bridge: PrintBridge | undefined = typeof window === 'undefined'
    ? undefined
    : window.parkitDesktop,
): Promise<ReceiptPrintOutcome> {
  if (!bridge || typeof bridge.printTicket !== 'function') {
    return { ok: false, reason: 'no-bridge' };
  }

  try {
    const settings = readPrinterSettings();
    const paper = resolvePaperSize(settings);
    const template = readCashSessionTemplateSettings(data.tenantId);
    return await bridge.printTicket({
      html: buildCashSessionSummaryHtml(data, paper.bodyWidthMm, template),
      deviceName: settings.deviceName,
      tailFeedMm: settings.tailFeedMm,
      mediaWidthMm: paper.mediaWidthMm,
      bodyWidthMm: paper.bodyWidthMm,
    });
  } catch (error) {
    return { ok: false, reason: 'print-failed', detail: String(error) };
  }
}

export function describeCashSummaryPrintFailure(
  outcome: ReceiptPrintOutcome,
): string {
  if (outcome.ok) return '';
  switch (outcome.reason) {
    case 'no-bridge':
    case 'no-window':
      return 'La impresión solo está disponible en la app de escritorio.';
    case 'no-printer':
      return 'No hay impresoras instaladas para imprimir el resumen.';
    case 'printer-not-found':
      return 'La impresora configurada no está disponible. Elegí otra en Impresora.';
    case 'timeout':
      return 'La impresora no respondió.';
    default:
      return 'No se pudo imprimir el resumen.';
  }
}
