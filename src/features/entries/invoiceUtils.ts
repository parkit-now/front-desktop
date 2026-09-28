import type { ArcaTaxCondition, TaxpayerDto } from '../../lib/api/arca';
import type { InvoiceSummaryDto } from '../../lib/api/entries';
import { translateErrorCode } from '../../lib/api/translate';
import type { PaymentMethodInvoiceMode } from '../../lib/db/localDb';

/**
 * Lógica pura de la factura en el cobro y en el historial. Gemela de la del
 * panel web (`front-web/src/features/owner/sections/operacion/invoiceUtils.ts`):
 * si cambia acá, cambiar allá.
 */

const LETTER_BY_CBTE_TIPO: Record<number, string> = { 1: 'A', 6: 'B', 11: 'C' };

/** `0001-00000123`: el formato con el que ARCA y el PDF muestran el número. */
export function formatVoucherNumber(ptoVta: number, cbteNro: number): string {
  return `${String(ptoVta).padStart(4, '0')}-${String(cbteNro).padStart(8, '0')}`;
}

export function invoiceLetter(cbteTipo: number | null | undefined): string {
  return (cbteTipo != null && LETTER_BY_CBTE_TIPO[cbteTipo]) || '';
}

export interface InvoiceNotice {
  readonly tone: 'success' | 'warning' | 'info';
  /**
   * Lo que va en la fila «Factura» del resumen del egreso. Si no salió, es el
   * mensaje corto del `errorCode`: el detalle técnico de ARCA queda guardado
   * en la factura, no se le muestra al operario.
   */
  readonly text: string;
  /** Segunda línea, más chica: a quién se emitió (si fue con CUIT). */
  readonly detail?: string;
}

const FALLBACK_MESSAGE = 'No se pudo emitir la factura. Intentalo más tarde.';

/** `receptorNombre` que guarda el backend en una factura sin CUIT. */
const CONSUMIDOR_FINAL = 'Consumidor Final';

/**
 * Qué decirle al operario sobre la factura después de confirmar el egreso.
 * `null` = nada: la playa no factura o el medio no se factura al cobrar.
 *
 * Offline no hay respuesta del backend: se avisa que se emite al sincronizar
 * sólo si TODOS los medios cobrados están en Automática (si no, no se emite
 * sola y prometerlo sería mentir).
 */
export function describeInvoiceResult(input: {
  readonly invoice: InvoiceSummaryDto | null | undefined;
  readonly offline: boolean;
  readonly lineModes: readonly (PaymentMethodInvoiceMode | undefined)[];
}): InvoiceNotice | null {
  if (input.offline) {
    const auto =
      input.lineModes.length > 0 &&
      input.lineModes.every((mode) => mode === 'auto');
    return auto
      ? { tone: 'info', text: 'La factura se emite al sincronizar.' }
      : null;
  }

  const invoice = input.invoice;
  if (!invoice) return null;

  switch (invoice.status) {
    case 'issued': {
      const parts = ['Factura', invoiceLetter(invoice.cbteTipo)];
      if (invoice.ptoVta != null && invoice.cbteNro != null) {
        parts.push(formatVoucherNumber(invoice.ptoVta, invoice.cbteNro));
      }
      parts.push('emitida');
      const text = parts.filter(Boolean).join(' ');
      // Con CUIT dice a quién: el operario confirma que salió con el que dio
      // el cliente. A consumidor final no hace falta.
      return invoice.receptorNombre &&
        invoice.receptorNombre !== CONSUMIDOR_FINAL
        ? { tone: 'success', text, detail: `a ${invoice.receptorNombre}` }
        : { tone: 'success', text };
    }
    case 'error':
    case 'issuing':
      return {
        tone: 'warning',
        text: translateErrorCode(invoice.errorCode) ?? FALLBACK_MESSAGE,
      };
    case 'pending':
      // Pendiente CON motivo (certificado vencido, falta el receptor): se
      // quiso emitir y no se pudo. Sin motivo es un medio en Manual: nada.
      return invoice.errorCode
        ? {
            tone: 'warning',
            text: translateErrorCode(invoice.errorCode) ?? FALLBACK_MESSAGE,
          }
        : null;
    default:
      // `not_required`: nada que mostrar en el cobro.
      return null;
  }
}

// ── Receptor: consumidor final o con CUIT ──────────────────────────────────

/** Pesos del dígito verificador del CUIT/CUIL (módulo 11). */
const CUIT_WEIGHTS = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2] as const;

/** Deja sólo los dígitos: acepta `20-12345678-3` y `20 12345678 3`. */
export function normalizeCuit(raw: string): string {
  return raw.replace(/\D/g, '');
}

/**
 * 11 dígitos y dígito verificador correcto. Gemela de
 * `backend/src/arca/arca-cuit.ts`: acá se avisa antes de cobrar, pero la regla
 * que vale es la del backend.
 */
export function isValidCuit(cuit: string): boolean {
  if (!/^\d{11}$/.test(cuit)) return false;
  const digits = [...cuit].map(Number);
  const sum = CUIT_WEIGHTS.reduce((acc, w, i) => acc + w * digits[i], 0);
  const mod = 11 - (sum % 11);
  const expected = mod === 11 ? 0 : mod;
  return expected !== 10 && expected === digits[10];
}

/** Mensaje del campo CUIT, o `null` si está bien. */
export function receiverCuitError(raw: string): string | null {
  const cuit = normalizeCuit(raw);
  if (cuit.length === 0) return 'Ingresá el CUIT del cliente.';
  if (!isValidCuit(cuit)) return 'El CUIT no es válido.';
  return null;
}

export type InvoiceLetter = 'A' | 'B' | 'C';

/** A quién se factura: consumidor final (la de siempre) o el CUIT del cliente. */
export type ReceiverChoice = 'final' | 'cuit';

/** La letra a consumidor final: B si la playa es RI; C si no. */
export function consumerFinalLetter(
  emitter: ArcaTaxCondition | null | undefined,
): InvoiceLetter {
  return emitter === 'responsable_inscripto' ? 'B' : 'C';
}

/** Cómo va la consulta al padrón del CUIT tipeado. */
export type TaxpayerLookup =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | { readonly status: 'done'; readonly taxpayer: TaxpayerDto }
  | { readonly status: 'error'; readonly message: string };

/**
 * El receptor que se manda al backend, o `undefined` = consumidor final.
 *
 * - Un CUIT que ARCA no tiene (producción) no se manda: la factura va a
 *   consumidor final, como ya se le avisó al operario.
 * - Si la consulta falló (ARCA caída) se manda igual: el backend vuelve a
 *   consultar al emitir y, si sigue caída, la factura queda para reintentar.
 */
export function receiverCuitToSend(input: {
  readonly choice: ReceiverChoice;
  readonly cuit: string;
  readonly lookup: TaxpayerLookup;
}): string | undefined {
  if (input.choice !== 'cuit') return undefined;
  const cuit = normalizeCuit(input.cuit);
  if (!isValidCuit(cuit)) return undefined;
  if (input.lookup.status === 'done' && !input.lookup.taxpayer.identified) {
    return undefined;
  }
  return cuit;
}

/**
 * Si ya se puede confirmar: a consumidor final siempre; con CUIT, cuando es
 * válido y la consulta al padrón terminó (bien o mal).
 */
export function isReceiverReady(input: {
  readonly choice: ReceiverChoice;
  readonly cuit: string;
  readonly lookup: TaxpayerLookup;
}): boolean {
  if (input.choice === 'final') return true;
  return (
    isValidCuit(normalizeCuit(input.cuit)) &&
    (input.lookup.status === 'done' || input.lookup.status === 'error')
  );
}

/**
 * La letra que va a salir, para el botón y la confirmación. `null` si no se
 * sabe todavía: con CUIT y sin respuesta del padrón (un RI puede emitir A o B).
 */
export function expectedLetter(input: {
  readonly emitter: ArcaTaxCondition | null | undefined;
  readonly choice: ReceiverChoice;
  readonly lookup: TaxpayerLookup;
}): InvoiceLetter | null {
  const consumer = consumerFinalLetter(input.emitter);
  if (input.choice === 'final' || consumer === 'C') return consumer;
  return input.lookup.status === 'done' ? input.lookup.taxpayer.letter : null;
}

export interface TaxpayerNotice {
  readonly tone: 'success' | 'info' | 'warning';
  readonly text: string;
  readonly detail?: string;
}

/**
 * La línea debajo del CUIT con lo que dijo el padrón: qué letra sale y a
 * quién. `null` mientras no hay nada que decir.
 */
export function describeTaxpayerLookup(
  lookup: TaxpayerLookup,
): TaxpayerNotice | null {
  switch (lookup.status) {
    case 'idle':
      return null;
    case 'loading':
      return { tone: 'info', text: 'Consultando ARCA…' };
    case 'error':
      return {
        tone: 'warning',
        text: lookup.message,
        detail: 'Se vuelve a consultar al emitir.',
      };
    case 'done': {
      const t = lookup.taxpayer;
      if (!t.identified) {
        return {
          tone: 'warning',
          text: 'ARCA no tiene datos de ese CUIT.',
          detail: `Se emite Factura ${t.letter} a consumidor final.`,
        };
      }
      const who = t.razonSocial ?? `CUIT ${formatCuit(t.cuit)}`;
      if (t.assumed) {
        return {
          tone: 'info',
          text: `Factura ${t.letter} · ${who}`,
          detail:
            'Homologación: ARCA no tiene datos de prueba de este CUIT, se toma como Responsable Inscripto.',
        };
      }
      // Un RI que no puede emitir A (receptor exento, consumidor final):
      // se aclara por qué sale B, que es lo que el cliente no espera.
      return {
        tone: t.letter === 'B' ? 'info' : 'success',
        text: `Factura ${t.letter} · ${who}`,
        detail:
          t.letter === 'B' && t.condicionIva
            ? `${t.condicionIva}: no recibe Factura A.`
            : (t.condicionIva ?? undefined),
      };
    }
  }
}

/**
 * Si al terminar el cobro se ofrece «Emitir factura»: la playa factura, hay
 * red y la factura quedó sin emitir (medio en Manual, o un intento que falló
 * y se puede reintentar, por ejemplo un CUIT que ARCA no tiene).
 */
export function canIssueAfterCharge(
  invoice: InvoiceSummaryDto | null | undefined,
): boolean {
  return invoice?.status === 'pending' || invoice?.status === 'error';
}

/**
 * Texto del «¿Seguro?» antes de emitir a mano: una factura emitida tiene
 * efecto fiscal y no se anula desde Parkit, así que se repite qué sale y a
 * quién. `amount` ya formateado (`$ 5.200,00`).
 */
export function describeIssueConfirmation(input: {
  readonly letter: InvoiceLetter | null;
  readonly cuit: string | null | undefined;
  readonly receiverName?: string | null;
  readonly amount: string;
}): { title: string; message: string; confirmLabel: string } {
  const to = input.cuit
    ? input.receiverName
      ? `a ${input.receiverName} (CUIT ${formatCuit(input.cuit)})`
      : `al CUIT ${formatCuit(input.cuit)}`
    : 'a consumidor final';
  const name = input.letter ? `la Factura ${input.letter}` : 'la factura';
  return {
    title: `¿Emitir ${name}?`,
    message: `Se emite ${to} por ${input.amount}. Una factura emitida no se puede anular desde Parkit.`,
    confirmLabel: input.letter ? `Emitir Factura ${input.letter}` : 'Emitir',
  };
}

/** `30712345671` → `30-71234567-1`. */
export function formatCuit(raw: string): string {
  const cuit = normalizeCuit(raw);
  return cuit.length === 11
    ? `${cuit.slice(0, 2)}-${cuit.slice(2, 10)}-${cuit.slice(10)}`
    : raw;
}

// ── Historial: estado de facturación de cada cobro ─────────────────────────

/**
 * Estado de facturación de un cobro:
 * - `issued` / `issuing` / `error` / `pending`: el de la factura de ARCA.
 * - `manual`: sin factura de ARCA, marcada «Facturada» a mano.
 * - `none`: cobrada y sin factura (medio sin facturación, o playa sin ARCA).
 * - `na`: no se factura (auto en base, o cobro de $0).
 */
export type InvoiceState =
  | 'issued'
  | 'issuing'
  | 'error'
  | 'pending'
  | 'manual'
  | 'none'
  | 'na';

export const INVOICE_STATE_LABEL: Record<InvoiceState, string> = {
  issued: 'Facturada',
  issuing: 'Emitiendo',
  error: 'Con error',
  pending: 'Pendiente',
  manual: 'Facturada a mano',
  none: 'Sin factura',
  na: 'No aplica',
};

/** Clase de `.status-badge` para cada estado. */
export const INVOICE_STATE_BADGE: Record<InvoiceState, string> = {
  issued: 'status-ok',
  issuing: 'status-brand',
  error: 'status-err',
  pending: 'status-warn',
  manual: 'status-ok',
  none: 'status-muted',
  na: 'status-muted',
};

/** Orden de las opciones del filtro «Factura». */
export const INVOICE_STATE_ORDER: readonly InvoiceState[] = [
  'pending',
  'none',
  'error',
  'issuing',
  'issued',
  'manual',
  'na',
];

export function resolveInvoiceState(
  entry: {
    leftAt?: string | null;
    paidTotal: number | null;
    manuallyInvoiced?: boolean;
  },
  invoice: { status: string } | undefined,
): InvoiceState {
  switch (invoice?.status) {
    case 'issued':
    case 'issuing':
    case 'error':
    case 'pending':
      return invoice.status;
    default:
      break;
  }
  if (!entry.leftAt || !(entry.paidTotal != null && entry.paidTotal > 0)) {
    return 'na';
  }
  return entry.manuallyInvoiced ? 'manual' : 'none';
}

/**
 * «Sin facturar» = Pendiente + Sin factura + Con error: una con error tampoco
 * está facturada, así que va en el mismo chip (no hay uno aparte).
 */
export function isUnbilled(state: InvoiceState): boolean {
  return state === 'pending' || state === 'none' || state === 'error';
}

export type InvoiceChip = 'all' | 'unbilled';

export function matchesInvoiceChip(
  state: InvoiceState,
  chip: InvoiceChip,
): boolean {
  return chip === 'unbilled' ? isUnbilled(state) : true;
}

export function countInvoiceChips(
  rows: ReadonlyArray<{ invoiceState: InvoiceState }>,
): Record<InvoiceChip, number> {
  return {
    all: rows.length,
    unbilled: rows.filter((row) => isUnbilled(row.invoiceState)).length,
  };
}

/** «Factura B 0001-00000123», o sólo «Factura B» si todavía no tiene número. */
export function voucherLabel(invoice: {
  cbteTipo?: number | null;
  ptoVta?: number | null;
  cbteNro?: number | null;
}): string | null {
  const letter = invoiceLetter(invoice.cbteTipo);
  if (!letter) return null;
  return invoice.ptoVta != null && invoice.cbteNro != null
    ? `Factura ${letter} ${formatVoucherNumber(invoice.ptoVta, invoice.cbteNro)}`
    : `Factura ${letter}`;
}

/**
 * `2026-10-04` → `04/10/2026`, sin pasar por `Date` (que lo leería a las
 * 00:00 UTC y en Argentina daría el día anterior).
 */
export function formatIsoDay(value: string | null | undefined): string | null {
  const match = value ? /^(\d{4})-(\d{2})-(\d{2})/.exec(value) : null;
  return match ? `${match[3]}/${match[2]}/${match[1]}` : null;
}

/** «EMPRESA SA · CUIT 30-71234567-1», o «Consumidor final». */
export function receiverDescription(invoice: {
  receptorDocTipo?: number | null;
  receptorDocNro?: string | null;
  receptorNombre?: string | null;
}): string {
  if (invoice.receptorDocTipo !== 80 || !invoice.receptorDocNro) {
    return 'Consumidor final';
  }
  const cuit = formatCuit(invoice.receptorDocNro);
  return invoice.receptorNombre
    ? `${invoice.receptorNombre} · CUIT ${cuit}`
    : `CUIT ${cuit}`;
}

/** Siempre termina en `.pdf`: `PATENTE-CAE-0001-00000006.pdf`. */
export function invoicePdfFileName(input: {
  plate: string;
  cae?: string | null;
  ptoVta?: number | null;
  cbteNro?: number | null;
}): string {
  const number =
    input.ptoVta != null && input.cbteNro != null
      ? formatVoucherNumber(input.ptoVta, input.cbteNro)
      : null;
  return `${[input.plate, input.cae, number].filter(Boolean).join('-')}.pdf`;
}
