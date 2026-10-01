import { formatArs, formatArgentinaDateTime } from '../format/argentina';
import { escapeHtml } from './html';
import { readPrinterSettings, resolvePaperSize } from './printerSettings';
import {
  defaultReceiptTemplateSettings,
  RECEIPT_TEMPLATE_FIELD_LABELS,
  readReceiptTemplateSettings,
  type ReceiptTemplateField,
  type ReceiptTemplateFieldId,
  type ReceiptTemplateSettings,
} from './receiptTemplate';

type PrintBridge = NonNullable<Window['parkitDesktop']>;

export type ReceiptPrintOutcome =
  | DesktopPrintResult
  | { ok: false; reason: 'no-bridge' };

export interface ReceiptData {
  tenantId?: string | null;
  parkingName?: string | null;
  parkingAddress?: string | null;
  parkingCuit?: string | null;
  plate: string;
  ticketNumber?: number;
  amountDue: number;
  received?: number;
  change?: number;
  paymentMethodName: string;
  enteredAt: string;
  leftAt: string;
}

export interface PaymentReceiptOptions {
  bodyWidthMm?: number | null;
  template?: ReceiptTemplateSettings | null;
}

const DEFAULT_BODY_WIDTH_MM = 72;

function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function resolveBridge(): PrintBridge | undefined {
  if (typeof window === 'undefined') return undefined;
  return window.parkitDesktop;
}

function row(label: string, value: string | null | undefined): string {
  const cleanValue = clean(value);
  if (!cleanValue) return '';
  return (
    '<div class="r-row">' +
    `<span class="r-label">${escapeHtml(label)}</span>` +
    `<span class="r-value">${escapeHtml(cleanValue)}</span>` +
    '</div>'
  );
}

function valueForField(
  id: ReceiptTemplateFieldId,
  data: ReceiptData,
  template: ReceiptTemplateSettings,
): string | null {
  const cuit = clean(data.parkingCuit) ?? clean(template.cuitOverride) ?? null;

  switch (id) {
    case 'parkingName':
      return clean(data.parkingName);
    case 'parkingAddress':
      return clean(data.parkingAddress);
    case 'parkingCuit':
      return cuit ? `CUIT: ${cuit}` : null;
    case 'grossIncome':
      return clean(template.grossIncomeText);
    case 'nonFiscalControl':
      return clean(template.nonFiscalControlText);
    case 'receiptTitle':
      return 'Comprobante de pago no fiscal';
    case 'plate':
      return clean(data.plate) ?? 'S/D';
    case 'ticketNumber':
      return data.ticketNumber != null ? String(data.ticketNumber) : null;
    case 'entryDateTime':
      return formatArgentinaDateTime(data.enteredAt);
    case 'exitDateTime':
      return formatArgentinaDateTime(data.leftAt);
    case 'paymentMethod':
      return clean(data.paymentMethodName);
    case 'amount':
      return formatArs(data.amountDue);
    case 'received':
      return data.received !== undefined ? formatArs(data.received) : null;
    case 'change':
      return data.change !== undefined ? formatArs(data.change) : null;
    default:
      return null;
  }
}

function isHeaderField(id: ReceiptTemplateFieldId): boolean {
  return (
    id === 'parkingName' ||
    id === 'parkingAddress' ||
    id === 'parkingCuit' ||
    id === 'grossIncome' ||
    id === 'nonFiscalControl'
  );
}

function renderTemplateField(
  field: ReceiptTemplateField,
  value: string,
): string {
  const label = RECEIPT_TEMPLATE_FIELD_LABELS[field.id];
  const style =
    `font-size:${field.fontSizePt}pt;` +
    `font-weight:${field.emphasis === 'bold' ? 800 : 400};`;

  if (field.id === 'receiptTitle') {
    return `<div class="r-title" style="${style}">${escapeHtml(value)}</div>`;
  }

  if (field.id === 'plate') {
    return (
      `<div class="r-plate" style="${style}">` +
      `<span>Patente</span><span>${escapeHtml(value)}</span></div>`
    );
  }

  if (field.id === 'amount') {
    return (
      `<div class="r-row r-total" style="${style}">` +
      `<span>Monto</span><span>${escapeHtml(value)}</span></div>`
    );
  }

  if (isHeaderField(field.id)) {
    return `<div class="r-meta-line" style="${style}">${escapeHtml(value)}</div>`;
  }

  return row(label, value).replace(
    'class="r-row"',
    `class="r-row" style="${style}"`,
  );
}

export function buildPaymentReceiptHtml(
  data: ReceiptData,
  options: PaymentReceiptOptions = {},
): string {
  const bodyWidthMm =
    options.bodyWidthMm === undefined
      ? DEFAULT_BODY_WIDTH_MM
      : options.bodyWidthMm;
  const bodyWidthCss =
    bodyWidthMm === null
      ? 'width: 100%; max-width: 80mm;'
      : `width: ${bodyWidthMm}mm;`;

  const template =
    options.template ??
    defaultReceiptTemplateSettings(data.tenantId?.trim() || 'default');
  const jobTitle = [
    'Comprobante no fiscal',
    clean(data.plate),
    data.ticketNumber != null ? `Ticket ${data.ticketNumber}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const rendered = template.fields
    .filter((field) => field.visible)
    .map((field) => {
      const value = valueForField(field.id, data, template);
      return value ? renderTemplateField(field, value) : null;
    })
    .filter((line): line is string => line !== null);

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(jobTitle)}</title>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';" />
<style>
  @page { margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; }
  body {
    ${bodyWidthCss}
    margin: 0 auto;
    padding: 1.5mm 0 2mm;
    color: #000;
    font-family: "Segoe UI", "DejaVu Sans", "Helvetica Neue", Arial, sans-serif;
    font-size: 8.5pt;
    line-height: 1.14;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .r-wrap { display: grid; gap: .85mm; }
  .r-head { text-align: center; overflow-wrap: anywhere; }
  .r-name { font-size: 10pt; font-weight: 800; text-transform: uppercase; }
  .r-meta-line { text-align: center; overflow-wrap: anywhere; }
  .r-title { border-top: 1px dashed #000; border-bottom: 1px dashed #000; padding: .9mm 0 .7mm; text-align: center; font-size: 8pt; font-weight: 800; text-transform: uppercase; }
  .r-row { display: flex; justify-content: space-between; align-items: baseline; gap: 2mm; margin: .2mm 0; }
  .r-label { text-transform: uppercase; }
  .r-value { font-weight: 700; text-align: right; word-break: break-word; }
  .r-plate { display: flex; justify-content: space-between; align-items: baseline; gap: 2mm; font-size: 16pt; font-weight: 900; line-height: 1; }
  .r-total { border-top: 1px dashed #000; margin-top: .6mm; padding-top: 1mm; font-size: 13pt; font-weight: 900; }
  .r-foot { border-top: 1px dashed #000; margin-top: .8mm; padding-top: .8mm; text-align: center; font-size: 7pt; text-transform: uppercase; }
</style>
</head>
<body>
<div class="r-wrap">
  ${rendered.join('')}
</div>
</body>
</html>`;
}

export async function printReceipt(
  data: ReceiptData,
  bridge: PrintBridge | undefined = resolveBridge(),
): Promise<ReceiptPrintOutcome> {
  if (!bridge || typeof bridge.printTicket !== 'function') {
    return { ok: false, reason: 'no-bridge' };
  }

  try {
    const settings = readPrinterSettings();
    const paper = resolvePaperSize(settings);
    const template = readReceiptTemplateSettings(data.tenantId ?? 'default');
    return await bridge.printTicket({
      html: buildPaymentReceiptHtml(data, {
        bodyWidthMm: paper.bodyWidthMm,
        template,
      }),
      deviceName: settings.deviceName,
      tailFeedMm: settings.tailFeedMm,
      mediaWidthMm: paper.mediaWidthMm,
      bodyWidthMm: paper.bodyWidthMm,
    });
  } catch (error) {
    return { ok: false, reason: 'print-failed', detail: String(error) };
  }
}

export function describeReceiptPrintFailure(
  outcome: ReceiptPrintOutcome,
): string {
  if (outcome.ok) return '';
  switch (outcome.reason) {
    case 'no-bridge':
    case 'no-window':
      return 'La impresión solo está disponible en la app de escritorio.';
    case 'no-printer':
      return 'No hay impresoras instaladas.';
    case 'printer-not-found':
      return 'La impresora configurada no está disponible. Elegí otra en Impresora.';
    case 'timeout':
      return 'La impresora no respondió.';
    default:
      return 'No se pudo imprimir el comprobante.';
  }
}
