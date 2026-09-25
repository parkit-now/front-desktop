import type { InvoiceSummaryDto } from '../../lib/api/entries';
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
  readonly text: string;
}

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
      return { tone: 'success', text: parts.filter(Boolean).join(' ') };
    }
    case 'error':
    case 'issuing': {
      const reason = invoice.errorMessage?.trim();
      return {
        tone: 'warning',
        text: `No se pudo facturar${reason ? `: ${reason}` : ''}. Quedó pendiente.`,
      };
    }
    default:
      // `pending` y `not_required`: nada nuevo que mostrar en el cobro; se ve
      // en el historial.
      return null;
  }
}
