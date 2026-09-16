import type { PaymentMethodKind } from '../../lib/db/localDb';
import { calcStayPrice, type StayPrices } from './pricing';

export type { StayPrices };

export function generateUuidV7(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);

  const timestamp = BigInt(Date.now());
  bytes[0] = Number((timestamp >> 40n) & 0xffn);
  bytes[1] = Number((timestamp >> 32n) & 0xffn);
  bytes[2] = Number((timestamp >> 24n) & 0xffn);
  bytes[3] = Number((timestamp >> 16n) & 0xffn);
  bytes[4] = Number((timestamp >> 8n) & 0xffn);
  bytes[5] = Number(timestamp & 0xffn);
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(
    '',
  );
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function formatMinutes(totalMinutes: number): string {
  if (!Number.isFinite(totalMinutes)) return '—';
  const whole = Math.floor(totalMinutes);
  const hours = Math.floor(whole / 60);
  const minutes = whole % 60;
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
}

export function formatDuration(enteredAt: string): string {
  const ms = Date.now() - new Date(enteredAt).getTime();
  return formatMinutes(ms / 60000);
}

/**
 * Si un cobro entró al CAJÓN, que es lo único que el arqueo de caja necesita
 * saber.
 *
 * ANTES ESTO MIRABA EL NOMBRE, Y ERA UN BUG DE PLATA
 *
 *     return name.toLowerCase().includes('efectivo');
 *
 * Fallaba en las dos direcciones:
 *
 *   * El dueño renombra su método a "Caja" o "Contado" —tiene todo el derecho,
 *     `name` es editable— y su propio arqueo deja de contarle el efectivo. El
 *     esperado en caja da de menos y la diferencia le aparece al operador como
 *     faltante.
 *   * Un método `type='other'` llamado "Efectivo Mercado Pago" se contaba como
 *     plata en el cajón. No lo es: esa plata está en MP.
 *
 * Se intentó tapar renombrando los métodos del sistema a 'Efectivo' /
 * 'Transferencia' (migración 20260913163737). Eso arregla el caso por defecto,
 * no la causa: el primer dueño que renombra vuelve a romper su arqueo.
 *
 * AHORA MIRA EL TIPO, QUE ES UN SNAPSHOT
 *
 * No alcanzaba con leer `payment_methods.type` al arquear: el cierre se
 * calcula sobre Dexie, offline, y para ese entonces el método puede estar
 * renombrado o borrado. Así que el tipo se congela en el cobro, igual que el
 * nombre (`payment_transactions.payment_method_type`,
 * 20260913200901_payment_transactions_method_type_snapshot.sql).
 *
 * POR QUÉ QUEDA UN FALLBACK POR NOMBRE, SI EL BACKFILL YA LLENÓ TODO
 *
 * El backfill llena la BASE. Lo que el arqueo lee es la copia LOCAL, y esa se
 * actualiza sola, asincrónicamente y con el equipo posiblemente offline. Entre
 * el upgrade de Dexie (v13, que resetea el cursor) y el primer pull exitoso
 * hay una ventana real en la que una fila ya sincronizada no tiene tipo. Si en
 * esa ventana devolviéramos `false`, el efectivo desaparecería del arqueo —
 * exactamente el bug que estamos matando, reintroducido como carrera.
 *
 * El fallback es seguro por CÓMO está puesto: sólo corre cuando el tipo
 * FALTA, nunca para contradecirlo. Un "Efectivo Mercado Pago" no puede colarse
 * por acá, porque esa fila siempre trae `type: 'other'` explícito (la escribe
 * el código nuevo o la backfilleó la migración) y ni llega a la segunda línea.
 * O sea: el fallback sólo puede AGREGAR efectivo que de otro modo sería
 * invisible, nunca inventar uno que el tipo ya negó.
 *
 * Cuándo se puede borrar: cuando `paymentMethodType` deje de ser opcional en
 * `LocalPaymentTransaction`, lo que requiere garantizar que ningún equipo en
 * uso tenga filas anteriores a la v13.
 */
export function isCashMethod(
  type: PaymentMethodKind | undefined,
  name: string,
): boolean {
  if (type !== undefined) return type === 'cash';
  return name.toLowerCase().includes('efectivo');
}

export function computeChange(amountDue: number, received: number): number {
  return Math.max(0, received - amountDue);
}

export function calcSuggestedAmount(
  enteredAt: string,
  leftAt: string,
  prices: StayPrices,
): number {
  const ms = new Date(leftAt).getTime() - new Date(enteredAt).getTime();
  return calcStayPrice(ms / 60000, prices);
}
