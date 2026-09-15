import { ARGENTINA_TIME_ZONE } from '../format/argentina';
import { escapeHtml } from './html';

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
  vehicle: string | null;
  color: string | null;
  enteredAt: string;
  /** `LocalRate.shortcutNumber` — the rate number posted on the price board. */
  rateNumber: number | null;
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

function row(label: string, value: string): string {
  return (
    `<div class="t-row"><span class="t-label">${escapeHtml(label)}</span>` +
    `<span class="t-value">${escapeHtml(value)}</span></div>`
  );
}

function clean(value: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * Build the self-contained 80mm ticket handed to the customer at entry.
 *
 * Every optional field is omitted rather than rendered empty: a line reading
 * "Color —" on a paper stub is noise, and an unset parking address must never
 * print as "null".
 */
export function buildEntryTicketHtml(data: EntryTicketData): string {
  const name = clean(data.parkingName);
  const address = clean(data.parkingAddress);
  const vehicle = clean(data.vehicle);
  const color = clean(data.color);
  const date = formatTicketDate(data.enteredAt);
  const time = formatTicketTime(data.enteredAt);

  const header = [
    name ? `<div class="t-name">${escapeHtml(name)}</div>` : '',
    address ? `<div class="t-addr">${escapeHtml(address)}</div>` : '',
  ].join('');

  const rows = [
    vehicle ? row('Vehículo', vehicle) : '',
    color ? row('Color', color) : '',
    date ? row('Fecha', date) : '',
    time ? row('Ingreso', time) : '',
    data.rateNumber != null ? row('Tarifa', String(data.rateNumber)) : '',
  ].join('');

  // No open cash session means no number was assigned. Printing "0" or an
  // invented number would be worse than saying so on the paper.
  const ticket =
    data.ticketNumber != null
      ? `<div class="t-ticket-number">${escapeHtml(String(data.ticketNumber))}</div>`
      : `<div class="t-ticket-number t-ticket-number--missing">S/N</div>`;

  // El título es el nombre con el que el trabajo aparece en la cola del
  // sistema. Sin él, Chromium usa el data: URL entero y la cola queda ilegible.
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
    width: 72mm;
    margin: 0 auto;
    padding: 2mm 0 5mm;
    color: #000;
    font-family: "Segoe UI", "DejaVu Sans", "Helvetica Neue", Arial, sans-serif;
    font-size: 11pt;
    line-height: 1.25;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .t-head { text-align: center; }
  .t-name { font-size: 14pt; font-weight: 700; text-transform: uppercase; letter-spacing: .3px; }
  .t-addr { font-size: 9.5pt; margin-top: 1mm; }
  .t-rule { border: 0; border-top: 1px dashed #000; margin: 3mm 0; }
  .t-row { display: flex; justify-content: space-between; gap: 3mm; margin: 1.2mm 0; }
  .t-label { font-size: 9.5pt; text-transform: uppercase; letter-spacing: .4px; }
  .t-value { font-size: 11pt; font-weight: 700; text-align: right; word-break: break-word; }
  .t-ticket { margin-top: 4mm; padding: 2.5mm 0; border: 2px solid #000; text-align: center; }
  .t-ticket-label { font-size: 10pt; letter-spacing: 1px; text-transform: uppercase; }
  .t-ticket-number { font-size: 34pt; font-weight: 800; line-height: 1; margin-top: 1mm; }
  .t-ticket-number--missing { font-size: 20pt; }
</style>
</head>
<body>
<div class="t-head">${header}</div>
<hr class="t-rule" />
${rows}
<div class="t-ticket">
<div class="t-ticket-label">Ticket N°</div>
${ticket}
</div>
</body>
</html>`;
}
