import { ARGENTINA_TIME_ZONE } from '../format/argentina';
import { escapeHtml } from './html';
import {
  defaultTicketTemplateSettings,
  TICKET_TEMPLATE_FIELD_LABELS,
  type TicketTemplateField,
  type TicketTemplateFieldId,
  type TicketTemplateSettings,
} from './ticketTemplate';

// Fijados a la zona del negocio, igual que Historial y el modal de cobro: el
// número del papel tiene que coincidir con el de la pantalla cuando un cliente
// discute el importe, sin depender de cómo esté configurado el equipo.
const TICKET_DATE_FORMATTER = new Intl.DateTimeFormat('es-AR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: ARGENTINA_TIME_ZONE,
});

const TICKET_TIME_FORMATTER = new Intl.DateTimeFormat('es-AR', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: ARGENTINA_TIME_ZONE,
});

export interface EntryTicketData {
  parkingName: string | null;
  parkingAddress: string | null;
  parkingCuit?: string | null;
  plate?: string | null;
  vehicle?: string | null;
  vehicleBrand?: string | null;
  vehicleModel?: string | null;
  color: string | null;
  cochera?: string | null;
  notes?: string | null;
  enteredAt: string;
  /** `LocalRate.shortcutNumber` — the rate number posted on the price board. */
  rateNumber: number | null;
  rateName?: string | null;
  ticketNumber: number | null;
}

/** `DD/MM/AAAA`. Vacío si la fecha no parsea, para omitir la fila. */
export function formatTicketDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return TICKET_DATE_FORMATTER.format(date);
}

/** `HH:MM hs`. Vacío si la fecha no parsea, para omitir la fila. */
export function formatTicketTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return `${TICKET_TIME_FORMATTER.format(date)} hs`;
}

function clean(value: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function valueForField(
  id: TicketTemplateFieldId,
  data: EntryTicketData,
  template: TicketTemplateSettings,
): string | null {
  const date = formatTicketDate(data.enteredAt);
  const time = formatTicketTime(data.enteredAt);
  const rate =
    clean(data.rateName ?? null) ??
    (data.rateNumber != null ? String(data.rateNumber) : null);
  const cuit =
    clean(data.parkingCuit ?? null) ?? clean(template.cuitOverride) ?? null;

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
    case 'ticketNumber':
      return data.ticketNumber != null ? String(data.ticketNumber) : 'S/N';
    case 'plate':
      return clean(data.plate ?? null);
    case 'vehicleBrand':
      return clean(data.vehicleBrand ?? null);
    case 'vehicleModel':
      return clean(data.vehicleModel ?? data.vehicle ?? null);
    case 'color':
      return clean(data.color);
    case 'rate':
      return rate;
    case 'entryDate':
      return date || null;
    case 'entryTime':
      return time || null;
    case 'cochera':
      return clean(data.cochera ?? null);
    case 'notes':
      return clean(data.notes ?? null);
    default:
      return null;
  }
}

function isHeaderField(id: TicketTemplateFieldId): boolean {
  return (
    id === 'parkingName' ||
    id === 'parkingAddress' ||
    id === 'parkingCuit' ||
    id === 'grossIncome' ||
    id === 'nonFiscalControl'
  );
}

function renderField(
  field: TicketTemplateField,
  value: string,
  first: boolean,
): string {
  const label = TICKET_TEMPLATE_FIELD_LABELS[field.id];
  const style =
    `font-size:${field.fontSizePt}pt;` +
    `font-weight:${field.emphasis === 'bold' ? 800 : 400};`;

  if (field.id === 'ticketNumber') {
    return (
      `<div class="t-line t-line--hero" style="${style}">` +
      `<span class="t-hero-label">Ticket N°</span>` +
      `<span class="t-hero-value">${escapeHtml(value)}</span>` +
      `</div>`
    );
  }

  if (field.id === 'plate') {
    return (
      `<div class="t-line t-line--hero" style="${style}">` +
      `<span class="t-hero-label">Patente</span>` +
      `<span class="t-hero-value">${escapeHtml(value)}</span>` +
      `</div>`
    );
  }

  if (isHeaderField(field.id)) {
    return (
      `<div class="t-line t-line--head ${first ? 't-line--first' : ''}" ` +
      `style="${style}">${escapeHtml(value)}</div>`
    );
  }

  return (
    `<div class="t-row" style="${style}">` +
    `<span class="t-label">${escapeHtml(label)}</span>` +
    `<span class="t-value">${escapeHtml(value)}</span></div>`
  );
}

/**
 * Build the self-contained 80mm ticket handed to the customer at entry.
 *
 * Every optional field is omitted rather than rendered empty: a line reading
 * "Color —" on a paper stub is noise, and an unset parking address must never
 * print as "null".
 */
export interface EntryTicketOptions {
  bodyWidthMm?: number | null;
  template?: TicketTemplateSettings | null;
}

const DEFAULT_BODY_WIDTH_MM = 72;

export function buildEntryTicketHtml(
  data: EntryTicketData,
  options: EntryTicketOptions = {},
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
    options.template ?? defaultTicketTemplateSettings(data.parkingName ?? '');
  const rendered = template.fields
    .filter((field) => field.visible)
    .map((field) => {
      const value = valueForField(field.id, data, template);
      return value
        ? {
            html: renderField(field, value, false),
            isHeader: isHeaderField(field.id),
          }
        : null;
    })
    .filter(
      (line): line is { html: string; isHeader: boolean } => line !== null,
    );
  const firstHeaderIndex = rendered.findIndex((line) => line.isHeader);
  const hasHeader = rendered.some((line) => line.isHeader);
  const firstBodyIndex = rendered.findIndex((line) => !line.isHeader);
  const hasCompactBody = rendered.some((line) => !line.isHeader);
  const lines = rendered.map((line, index) =>
    index === firstHeaderIndex
      ? {
          ...line,
          html: line.html.replace(
            't-line--head ',
            't-line--head t-line--first ',
          ),
        }
      : line,
  );

  // El título es el nombre con el que el trabajo aparece en la cola del
  // sistema. Sin él, Chromium usa el data: URL entero y la cola queda ilegible.
  const name = clean(data.parkingName);
  const jobTitle = [
    data.ticketNumber != null ? `Ticket ${data.ticketNumber}` : 'Ticket',
    name,
  ]
    .filter(Boolean)
    .join(' · ');

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
    padding: 1.2mm 0 2mm;
    color: #000;
    font-family: "Segoe UI", "DejaVu Sans", "Helvetica Neue", Arial, sans-serif;
    font-size: 9pt;
    line-height: 1.12;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .t-wrap { display: grid; gap: .7mm; }
  /* Envuelve por los espacios: "ESTACIONAMIENTO / ONCE" a tamaño completo se
     lee mejor que forzar un renglón único achicando la tipografía. Solo si una
     palabra sola no entra, main la achica al imprimir (ver electron/print.ts). */
  .t-line { overflow-wrap: anywhere; }
  .t-line--head { text-align: center; }
  .t-line--first { text-transform: uppercase; }
  .t-divider { border: 0; border-top: 1px dashed #000; margin: 1mm 0 .6mm; }
  .t-row { display: flex; justify-content: space-between; align-items: baseline; gap: 2mm; margin: .15mm 0; }
  .t-label { text-transform: uppercase; }
  .t-value { font-weight: inherit; text-align: right; word-break: break-word; }
  .t-line--hero { display: flex; justify-content: space-between; align-items: baseline; gap: 2mm; line-height: 1; }
  .t-hero-label { font-size: 8pt; font-weight: 400; text-transform: uppercase; }
  .t-hero-value { font-size: inherit; font-weight: inherit; }
</style>
</head>
<body>
<div class="t-wrap">
${lines
  .map((line, index) =>
    hasHeader && hasCompactBody && index === firstBodyIndex
      ? `<hr class="t-divider" />${line.html}`
      : line.html,
  )
  .join('')}
</div>
</body>
</html>`;
}
