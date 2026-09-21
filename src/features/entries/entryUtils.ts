import type {
  LocalPaymentMethod,
  PaymentMethodKind,
} from '../../lib/db/localDb';
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

/**
 * Si este medio de pago cobra con el QR de Mercado Pago.
 *
 * MIRA EL TIPO Y SÓLO EL TIPO — el `name` viaja en la firma a propósito
 *
 * Recibe el medio entero, no el tipo suelto, para que el que venga a leer esto
 * vea que el nombre ESTÁ disponible y aun así no se usa. Es la misma trampa
 * que ya se cobró una en `isCashMethod`: `name` es editable por el dueño, así
 * que cualquier regla que lo mire falla en las dos direcciones.
 *
 *   * Un medio `type='other'` llamado "Mercado Pago" —porque el dueño anota
 *     ahí las transferencias que le entran por la app— arrancaría un cobro con
 *     QR que nadie pidió, y le dejaría al operario una pantalla de espera por
 *     un pago que nunca va a llegar.
 *   * El medio real renombrado a "QR", "Código" o "Celular" dejaría de ofrecer
 *     el cobro con QR, que es justo la feature.
 *
 * Y A DIFERENCIA DE `isCashMethod`, ACÁ NO HAY FALLBACK POR NOMBRE
 *
 * En el arqueo, un tipo faltante se resuelve mirando el nombre porque el error
 * seguro es CONTAR DE MÁS: plata invisible es peor que plata mal etiquetada.
 * Acá el error seguro es el opuesto. Sin tipo no podemos afirmar que este
 * medio tenga una cuenta de Mercado Pago detrás, y adivinar termina en un POST
 * que falla con el cliente parado en la ventanilla. Sin tipo → no es QR, y el
 * operario cobra por donde venía cobrando hasta hoy.
 */
export function isMercadoPagoMethod(
  method: Pick<LocalPaymentMethod, 'type' | 'name'> | undefined,
): boolean {
  return method?.type === 'mercadopago_qr';
}

/**
 * Por qué NO se puede arrancar un cobro con QR ahora mismo. `null` = se puede.
 */
export type QrChargeBlockReason = 'offline' | 'entry-not-synced';

/**
 * Las dos precondiciones del cobro con QR, en un solo lugar y sin React para
 * poder testearlas.
 *
 * 1. EXIGE CONEXIÓN. No hay camino offline posible: el cobro vive en Mercado
 *    Pago, no en Dexie. Encolarlo sería peor que no ofrecerlo — la operación
 *    se aplicaría a ciegas horas después, contra un cliente que hace rato se
 *    fue. Es la misma excepción deliberada que el cierre de caja (ver
 *    AGENTS.md, "Excepción deliberada: cerrar caja exige conexión").
 *
 * 2. LA ESTADÍA TIENE QUE ESTAR SINCRONIZADA. `payment_intents.entry_id` tiene
 *    FK contra `entries` DEL SERVIDOR. Una estadía creada sin red todavía no
 *    existe del otro lado, así que el POST se estrella contra la FK y vuelve
 *    un error de base que no le dice nada a nadie. Las locales nacen con
 *    `syncSeq: 0` (ver `EntryFormCore`) y sólo el pull les pone uno > 0, así
 *    que ese número es el chequeo exacto: no "parece" sincronizada, LO ESTÁ.
 *
 * El orden importa: sin red, lo que hay que decirle al operario es que no hay
 * red. Que además la estadía esté sin sincronizar es una CONSECUENCIA de eso
 * —se creó en el mismo corte— y mostrarlo primero lo mandaría a resolver algo
 * que se arregla solo cuando vuelve la conexión.
 *
 * En los dos casos el efectivo sigue disponible. Ese es el punto: el auto sale
 * igual.
 */
export function qrChargeBlockReason(input: {
  isOnline: boolean;
  entrySyncSeq: number;
}): QrChargeBlockReason | null {
  if (!input.isOnline) return 'offline';
  if (input.entrySyncSeq <= 0) return 'entry-not-synced';
  return null;
}

/** Qué se le dice al operario cuando el QR no está disponible. */
export const QR_BLOCK_MESSAGES: Record<QrChargeBlockReason, string> = {
  offline:
    'Cobrar con QR necesita conexión con el servidor. Cobrá en efectivo y el auto sale igual.',
  'entry-not-synced':
    'Este ingreso se registró sin conexión y todavía no se sincronizó, así que Mercado Pago no lo conoce. Sincronizá y volvé a intentar, o cobrá en efectivo.',
};

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
