/**
 * Reservas en la caja (fase 6): lógica pura del banner del ingreso y del cobro
 * del excedente al salir. Sin React ni Dexie,
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

/** Día civil de Buenos Aires (YYYY-MM-DD). */
export function arDayKey(value: string | Date = new Date()): string {
  return DAY_FORMATTER.format(value instanceof Date ? value : new Date(value));
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

// ─── Llegada anticipada o tardía (fase 6c) ───────────────────────────────────

/** Cómo llegó (o llega) el auto respecto de la ventana de su reserva. */
export type ArrivalKind = 'early' | 'on_time' | 'late';

/** "50 min", "1 h", "1 h 30 min". */
export function formatMinutes(minutes: number): string {
  const total = Math.max(Math.round(minutes), 0);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

type ArrivalInput = {
  arrival?: string | null;
  minutesEarly?: number | null;
  minutesLate?: number | null;
  entryAt: string;
};

/**
 * Aviso de un ingreso YA vinculado que llegó antes o tarde (no bloquea nada).
 * `null` si llegó a tiempo o el backend no informó cómo llegó.
 */
export function arrivalNoticeText(input: ArrivalInput): string | null {
  if (input.arrival === 'early') {
    return `Llegó ${formatMinutes(input.minutesEarly ?? 0)} antes de su reserva de ${formatTime(input.entryAt)}. El tiempo extra se cobra al salir.`;
  }
  if (input.arrival === 'late') {
    return `Llegó tarde (reserva ${formatTime(input.entryAt)}).`;
  }
  return null;
}

/**
 * La misma idea en el banner del ingreso, ANTES de registrarlo (por eso en
 * presente). `null` si llega a tiempo.
 */
export function matchArrivalText(input: ArrivalInput): string | null {
  if (input.arrival === 'early') {
    return `Llega ${formatMinutes(input.minutesEarly ?? 0)} antes de su reserva de ${formatTime(input.entryAt)}. El tiempo extra se cobra al salir.`;
  }
  if (input.arrival === 'late') {
    return `Llega tarde (reserva ${formatTime(input.entryAt)}).`;
  }
  return null;
}

/**
 * Aviso de una reserva próxima (hoy o mañana, dentro de 24 h) a la que todavía
 * es muy temprano para vincular: el ingreso de ahora es una estadía común.
 */
export function upcomingReservationText(
  input: { entryAt: string; linkableFrom?: string | null },
  now: Date = new Date(),
): string {
  const day = arDayKey(input.entryAt) === arDayKey(now) ? 'hoy' : 'mañana';
  const head = `Esta patente tiene una reserva ${day} a las ${formatTime(input.entryAt)}.`;
  const tail = input.linkableFrom
    ? ` Si entra ahora, es una estadía común: la reserva se toma sola desde las ${formatTime(input.linkableFrom)}.`
    : ' Si entra ahora, es una estadía común.';
  return head + tail;
}

/**
 * ¿El ingreso de ahora se vincularía a la reserva del banner? Un backend
 * anterior a la 6c no manda `linkable`: todo lo que devolvía se vinculaba.
 */
export function isLinkableMatch(match: { linkable?: boolean | null }): boolean {
  return match.linkable !== false;
}

export type ExitBreakdown = {
  /** Duración de la franja reservada (lo que cubre el prepago), en minutos. */
  reservedMinutes: number;
  /** Minutos adentro antes de la hora de la reserva. */
  extraBeforeMinutes: number;
  /** Minutos adentro después del fin de la reserva. */
  extraAfterMinutes: number;
  /** Tiempo fuera de la franja reservada. */
  extraMinutes: number;
};

/**
 * Desglose de la salida con reserva: cuánto se reservó y cuánto tiempo estuvo
 * fuera de la franja (antes y después). Los montos no se reparten por tramo:
 * la tarifa no es lineal (primera hora entera, fracciones, topes), así que el
 * cobro sigue siendo `calcStayPrice(estadía real) − prepago`.
 */
export function exitBreakdown(input: {
  enteredAt: string;
  leftAt: string;
  reservationEntryAt: string;
  reservationExitAt: string;
}): ExitBreakdown {
  const minutes = (from: string, to: string) =>
    Math.max(Math.round((Date.parse(to) - Date.parse(from)) / 60_000), 0);
  const extraBeforeMinutes = minutes(input.enteredAt, input.reservationEntryAt);
  const extraAfterMinutes = minutes(input.reservationExitAt, input.leftAt);
  return {
    reservedMinutes: minutes(input.reservationEntryAt, input.reservationExitAt),
    extraBeforeMinutes,
    extraAfterMinutes,
    extraMinutes: extraBeforeMinutes + extraAfterMinutes,
  };
}

/**
 * El tiempo que estuvo fuera de la franja reservada, para la salida:
 * "50 min antes del horario", "15 min después del horario" o los dos. `null`
 * si estuvo dentro de la franja.
 */
export function formatOutsideTime(breakdown: ExitBreakdown): string | null {
  const parts: string[] = [];
  if (breakdown.extraBeforeMinutes > 0) {
    parts.push(
      `${formatMinutes(breakdown.extraBeforeMinutes)} antes del horario`,
    );
  }
  if (breakdown.extraAfterMinutes > 0) {
    parts.push(
      `${formatMinutes(breakdown.extraAfterMinutes)} después del horario`,
    );
  }
  return parts.length > 0 ? parts.join(' + ') : null;
}

/** Chip de la salida: "Llegó 50 min antes" / "Llegó tarde", o null. */
export function arrivalChipText(input: {
  arrival?: string | null;
  minutesEarly?: number | null;
}): string | null {
  if (input.arrival === 'early') {
    return `Llegó ${formatMinutes(input.minutesEarly ?? 0)} antes`;
  }
  if (input.arrival === 'late') return 'Llegó tarde';
  return null;
}
