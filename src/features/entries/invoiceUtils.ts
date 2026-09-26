import type { InvoiceSummaryDto } from '../../lib/api/entries';
import { translateErrorCode } from '../../lib/api/translate';
import type { PaymentMethodInvoiceMode } from '../../lib/db/localDb';

/**
 * Lógica pura de la factura en el cobro. Gemela de la del panel web (Etapa 2):
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
}

const FALLBACK_MESSAGE = 'No se pudo emitir la factura. Intentalo más tarde.';

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
      // La A dice a quién: el operario confirma que salió con el CUIT que dio
      // el cliente. La B y la C son siempre a consumidor final.
      if (invoice.cbteTipo === 1 && invoice.receptorNombre) {
        parts.push('a', invoice.receptorNombre);
      }
      return { tone: 'success', text: parts.filter(Boolean).join(' ') };
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

// ── Factura A: CUIT del cliente ─────────────────────────────────────────────

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

/** Sólo un Responsable Inscripto emite A; el resto factura siempre igual. */
export function canChooseInvoiceA(
  emitter: 'responsable_inscripto' | 'monotributo' | 'exento' | null,
): boolean {
  return emitter === 'responsable_inscripto';
}

/**
 * Si al terminar el cobro se ofrece «Emitir factura»: la playa factura, hay
 * red y la factura quedó sin emitir (medio en Manual, o un intento que falló
 * y se puede reintentar, por ejemplo una A con un CUIT que no la recibe).
 */
export function canIssueAfterCharge(
  invoice: InvoiceSummaryDto | null | undefined,
): boolean {
  return invoice?.status === 'pending' || invoice?.status === 'error';
}
