/**
 * Reservas en la caja (fase 6): lógica pura del banner del ingreso, del cobro
 * del excedente al salir y del panel "Reservas de hoy". Sin React ni Dexie,
 * para testearla sola.
 */
import { ARGENTINA_TIME_ZONE } from '../../lib/format/argentina';
import { calcSuggestedAmount, type StayPrices } from './entryUtils';
import { calcAmountDue } from './pricing';

/** Patente normalizada como en el backend: mayúsculas, sin espacios ni guiones. */
export function normalizePlate(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Código corto de la reserva (R-XXXXXX), el mismo que ven el conductor y el dueño. */
export function reservationCode(id: string): string {
  return `R-${id.replace(/-/g, '').slice(-6).toUpperCase()}`;
}

/**
 * ¿El match del banner sigue siendo de la patente que está tipeada? El match
 * llega con debounce: si el operador siguió escribiendo, el de la patente
 * vieja no se puede mandar con el ingreso.
 */
export function matchesPlate(
  match: { vehiclePlate: string } | null | undefined,
  plate: string,
): boolean {
  if (!match) return false;
  const normalized = normalizePlate(plate);
  return (
    normalized.length > 0 && normalizePlate(match.vehiclePlate) === normalized
  );
}

/** El prepago de un ingreso local, o `null` si no entró con reserva. */
export function prepaidOf(entry: {
  reservationId?: string;
  prepaidAmountArs?: string;
}): number | null {
  if (!entry.reservationId && entry.prepaidAmountArs === undefined) return null;
  const parsed = parseFloat(entry.prepaidAmountArs ?? '');
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export type ExitCharge = {
  /** La estadía completa según la tarifa congelada al ingresar. */
  stayTotal: number;
  /** Lo que ya pagó con la reserva; `null` si no entró con reserva. */
  prepaid: number | null;
  /** Lo que se cobra en la caja: `max(stayTotal − prepaid, 0)`. */
  due: number;
  /** Entró con reserva y el prepago cubre toda la estadía: se cierra sin cobro. */
  coveredByReservation: boolean;
};

/**
 * Cuánto se cobra al salir. Sin reserva es la estadía entera, como siempre.
 * Con reserva, sólo el excedente sobre lo que ya pagó por Mercado Pago (el
 * mismo cálculo que el backend usa para auditar el subcobro).
 */
export function exitCharge(input: {
  enteredAt: string;
  leftAt: string;
  prices: StayPrices;
  prepaid: number | null;
}): ExitCharge {
  const stayTotal = calcSuggestedAmount(
    input.enteredAt,
    input.leftAt,
    input.prices,
  );
  const due = calcAmountDue(stayTotal, input.prepaid);
  return {
    stayTotal,
    prepaid: input.prepaid,
    due,
    coveredByReservation: input.prepaid !== null && due <= 0,
  };
}

const TIME_FORMATTER = new Intl.DateTimeFormat('es-AR', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: ARGENTINA_TIME_ZONE,
});

const DAY_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  timeZone: ARGENTINA_TIME_ZONE,
});

/** Hora local de Buenos Aires (HH:MM). */
export function formatTime(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? '--:--' : TIME_FORMATTER.format(date);
}

/** "18:00 – 21:00", con "Hoy" adelante si empieza hoy. */
export function formatReservationWindow(
  entryAt: string,
  exitAt: string,
  now = new Date(),
): string {
  const range = `${formatTime(entryAt)} – ${formatTime(exitAt)}`;
  const sameDay =
    DAY_FORMATTER.format(new Date(entryAt)) === DAY_FORMATTER.format(now);
  return sameDay ? `Hoy ${range}` : range;
}

/**
 * El día civil de hoy en Buenos Aires como rango ISO, para pedir las reservas
 * de hoy. Argentina no tiene horario de verano: el offset es siempre -03:00.
 */
export function todayRangeIso(now = new Date()): { from: string; to: string } {
  const day = DAY_FORMATTER.format(now); // YYYY-MM-DD
  const from = new Date(`${day}T00:00:00-03:00`);
  const to = new Date(from.getTime() + 24 * 60 * 60_000 - 1);
  return { from: from.toISOString(), to: to.toISOString() };
}

export type ReservationPanelStatus =
  | 'pending_approval'
  | 'confirmed'
  | 'checked_in'
  | 'completed'
  | 'no_show';

/** Los estados que interesan en la caja: lo que puede llegar, lo que está adentro y lo que ya pasó. */
export const PANEL_STATUSES: readonly ReservationPanelStatus[] = [
  'pending_approval',
  'confirmed',
  'checked_in',
  'completed',
  'no_show',
];

export const STATUS_LABELS: Record<ReservationPanelStatus, string> = {
  pending_approval: 'Por aceptar',
  confirmed: 'Confirmada',
  checked_in: 'En curso',
  completed: 'Completada',
  no_show: 'No se presentó',
};

export function isPanelStatus(
  status: string,
): status is ReservationPanelStatus {
  return (PANEL_STATUSES as readonly string[]).includes(status);
}
