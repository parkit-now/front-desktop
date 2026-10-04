/**
 * Reservas en la caja (fase 6b): lógica pura de la sección "Reservas", donde
 * el dueño o el operador aceptan y rechazan las reservas por aceptar. Sin
 * React ni Dexie, para testearla sola.
 *
 * Copia a propósito las reglas de la pantalla del dueño en front-web
 * (`sections/reservas/reservationUtils.ts`): mismos estados, mismas acciones y
 * la misma cuenta regresiva, para que la caja y la web digan lo mismo.
 */
import { ApiError } from '../../lib/api/client';
import { translateApiError } from '../../lib/api/translate';
import type { LocalReservation } from '../../lib/db/localDb';
import { arDayKey, formatTime } from '../entries/reservationUtils';

export type ReservationBucket = 'pending' | 'today' | 'upcoming';

export const BUCKETS: readonly ReservationBucket[] = [
  'pending',
  'today',
  'upcoming',
];

export const BUCKET_LABELS: Record<ReservationBucket, string> = {
  pending: 'Por aceptar',
  today: 'Hoy',
  upcoming: 'Próximas',
};

type Status = LocalReservation['status'];

/**
 * Los estados que guarda la foto de la caja. `pending_payment` y `expired`
 * quedan afuera: son intentos que nunca se pagaron, nadie hace nada con ellos.
 */
export function isBoardStatus(status: Status): boolean {
  return status !== 'pending_payment' && status !== 'expired';
}

const TERMINAL: readonly Status[] = [
  'completed',
  'no_show',
  'rejected',
  'cancelled',
];

/**
 * En qué pestaña cae una reserva, o `null` si la caja no la muestra.
 *
 * - Por aceptar: todas las `pending_approval`, sean del día que sean.
 * - Hoy: las que están adentro (`checked_in`, aunque hayan entrado ayer), las
 *   confirmadas que empiezan hoy (o antes y todavía no llegaron) y las de hoy
 *   que ya se resolvieron (completada, no se presentó, rechazada, cancelada),
 *   para que el operador sepa qué pasó si el auto aparece igual.
 * - Próximas: las confirmadas de mañana en adelante.
 *
 * El historial completo queda en la web del dueño.
 */
export function bucketOf(
  r: Pick<LocalReservation, 'status' | 'entryAt'>,
  now: Date = new Date(),
): ReservationBucket | null {
  const today = arDayKey(now);
  const entryDay = arDayKey(r.entryAt);
  switch (r.status) {
    case 'pending_approval':
      return 'pending';
    case 'checked_in':
      return 'today';
    case 'confirmed':
      return entryDay <= today ? 'today' : 'upcoming';
    default:
      return TERMINAL.includes(r.status) && entryDay === today ? 'today' : null;
  }
}

export function countByBucket(
  rows: readonly Pick<LocalReservation, 'status' | 'entryAt'>[],
  now: Date = new Date(),
): Record<ReservationBucket, number> {
  const counts: Record<ReservationBucket, number> = {
    pending: 0,
    today: 0,
    upcoming: 0,
  };
  for (const r of rows) {
    const bucket = bucketOf(r, now);
    if (bucket) counts[bucket] += 1;
  }
  return counts;
}

/**
 * Las filas de una pestaña, ordenadas: por aceptar, la que vence antes
 * primero; hoy y próximas, la que empieza antes primero.
 */
export function rowsOf<
  T extends Pick<LocalReservation, 'status' | 'entryAt' | 'approvalDeadlineAt'>,
>(rows: readonly T[], bucket: ReservationBucket, now: Date = new Date()): T[] {
  const picked = rows.filter((r) => bucketOf(r, now) === bucket);
  if (bucket === 'pending') {
    return picked.sort((a, b) =>
      (a.approvalDeadlineAt ?? '').localeCompare(b.approvalDeadlineAt ?? ''),
    );
  }
  return picked.sort((a, b) => a.entryAt.localeCompare(b.entryAt));
}

export function isApprovalExpired(
  deadlineAt: string | null | undefined,
  now: number = Date.now(),
): boolean {
  if (!deadlineAt) return false;
  return new Date(deadlineAt).getTime() <= now;
}

/**
 * Las que esperan respuesta y todavía están a tiempo: el número del badge del
 * menú. Una vencida no cuenta aunque la foto (vieja, sin conexión) la siga
 * mostrando: el backend ya la rechaza sola.
 */
export function pendingCount(
  rows: readonly Pick<LocalReservation, 'status' | 'approvalDeadlineAt'>[],
  now: number = Date.now(),
): number {
  return rows.filter(
    (r) =>
      r.status === 'pending_approval' &&
      !isApprovalExpired(r.approvalDeadlineAt, now),
  ).length;
}

export type ReservationAction = 'accept' | 'reject';

/**
 * Qué se puede hacer desde la caja según el estado (la tabla del handoff de
 * la fase 5, recortada a lo que le toca a la caja). Por estado y NO por rol:
 * el backend deja actuar al dueño y al operador.
 *
 * - `pending_approval`: Aceptar y Rechazar. Pasado el plazo se esconde
 *   Aceptar (el backend contesta `RESERVATION_APPROVAL_EXPIRED` y el barrido
 *   la rechaza solo).
 * - El resto: nada. Cancelar una confirmada y reintentar un reembolso son del
 *   dueño, desde la web.
 */
export function availableActions(
  r: Pick<LocalReservation, 'status' | 'approvalDeadlineAt'>,
  now: number = Date.now(),
): ReservationAction[] {
  if (r.status !== 'pending_approval') return [];
  return isApprovalExpired(r.approvalDeadlineAt, now)
    ? ['reject']
    : ['accept', 'reject'];
}

export const OFFLINE_ACTIONS_MESSAGE =
  'Sin conexión: no se puede aceptar ni rechazar.';

/**
 * Las acciones de una fila tal como se dibujan: cuáles hay y si están
 * bloqueadas. Sin conexión se ven pero no se pueden tocar: aceptar y rechazar
 * mueven plata y tienen plazo, así que NUNCA se encolan para después.
 */
export function actionState(
  r: Pick<LocalReservation, 'status' | 'approvalDeadlineAt'>,
  isOnline: boolean,
  now: number = Date.now(),
): {
  actions: ReservationAction[];
  disabled: boolean;
  disabledReason: string | null;
} {
  const actions = availableActions(r, now);
  const blocked = !isOnline && actions.length > 0;
  return {
    actions,
    disabled: blocked,
    disabledReason: blocked ? OFFLINE_ACTIONS_MESSAGE : null,
  };
}

export interface Countdown {
  /** `mm:ss` (o `h:mm:ss` si queda más de una hora). */
  label: string;
  remainingMs: number;
  expired: boolean;
  /** Quedan menos de 3 minutos: se pinta en rojo. */
  urgent: boolean;
}

const URGENT_MS = 3 * 60_000;

/** Cuenta regresiva hasta `approvalDeadlineAt`. `null` si no hay plazo. */
export function countdownTo(
  deadlineAt: string | null | undefined,
  now: number = Date.now(),
): Countdown | null {
  if (!deadlineAt) return null;
  const remainingMs = new Date(deadlineAt).getTime() - now;
  if (Number.isNaN(remainingMs)) return null;
  if (remainingMs <= 0) {
    return { label: '00:00', remainingMs: 0, expired: true, urgent: true };
  }
  // Hacia arriba: "00:00" sólo se ve cuando ya venció de verdad.
  const totalSeconds = Math.ceil(remainingMs / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  const label = h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  return {
    label,
    remainingMs,
    expired: false,
    urgent: remainingMs < URGENT_MS,
  };
}

function shiftDayKey(day: string, days: number): string {
  const date = new Date(`${day}T12:00:00-03:00`);
  return arDayKey(new Date(date.getTime() + days * 24 * 60 * 60_000));
}

/** "Hoy 18:00–21:00", "Mañana 09:00–12:00", "05/10 18:00–21:00". */
export function formatSlot(
  entryAt: string,
  exitAt: string,
  now: Date = new Date(),
): string {
  const today = arDayKey(now);
  const entryDay = arDayKey(entryAt);
  const exitDay = arDayKey(exitAt);
  const dayLabel = (day: string) =>
    day === today
      ? 'Hoy'
      : day === shiftDayKey(today, 1)
        ? 'Mañana'
        : `${day.slice(8, 10)}/${day.slice(5, 7)}`;
  const head = dayLabel(entryDay);
  if (entryDay === exitDay) {
    return `${head} ${formatTime(entryAt)}–${formatTime(exitAt)}`;
  }
  return `${head} ${formatTime(entryAt)} – ${dayLabel(exitDay)} ${formatTime(exitAt)}`;
}

export type ChipTone = 'ok' | 'warn' | 'brand' | 'neutral' | 'err';

export interface Chip {
  label: string;
  tone: ChipTone;
}

/**
 * Chip de estado. En la caja "el dueño" es la playa, no "vos". Una en curso
 * dice además si el auto llegó antes de su ventana o tarde (fase 6c).
 */
export function statusChip(
  r: Pick<LocalReservation, 'status' | 'cancelledBy'> &
    Partial<Pick<LocalReservation, 'arrival'>>,
): Chip {
  switch (r.status) {
    case 'pending_approval':
      return { label: 'Por aceptar', tone: 'warn' };
    case 'confirmed':
      return { label: 'Confirmada', tone: 'ok' };
    case 'checked_in':
      return {
        label:
          r.arrival === 'early'
            ? 'En curso · llegó antes'
            : r.arrival === 'late'
              ? 'En curso · llegó tarde'
              : 'En curso',
        tone: 'brand',
      };
    case 'completed':
      return { label: 'Completada', tone: 'neutral' };
    case 'no_show':
      return { label: 'No se presentó', tone: 'neutral' };
    case 'rejected':
      return r.cancelledBy === 'system'
        ? { label: 'Vencida sin respuesta', tone: 'neutral' }
        : { label: 'Rechazada', tone: 'neutral' };
    case 'cancelled':
      if (r.cancelledBy === 'owner')
        return { label: 'Cancelada · playa', tone: 'neutral' };
      if (r.cancelledBy === 'driver')
        return { label: 'Cancelada · conductor', tone: 'neutral' };
      return { label: 'Cancelada · sistema', tone: 'neutral' };
    case 'expired':
      return { label: 'Vencida sin pago', tone: 'neutral' };
    case 'pending_payment':
      return { label: 'Esperando pago', tone: 'neutral' };
  }
}

/** Chip de reembolso; `null` cuando no hay nada para decir. */
export function refundChip(
  r: Pick<LocalReservation, 'status' | 'cancelledBy' | 'refundStatus'>,
): Chip | null {
  switch (r.refundStatus) {
    case 'refunded':
      return { label: 'Reembolsada', tone: 'ok' };
    case 'partial':
      return { label: 'Reembolso parcial', tone: 'ok' };
    case 'pending':
      return { label: 'Reembolso en curso', tone: 'warn' };
    case 'failed':
      return { label: 'Reembolso fallido', tone: 'err' };
    case 'none':
      if (
        r.status === 'no_show' ||
        (r.status === 'cancelled' && r.cancelledBy === 'driver')
      ) {
        return { label: 'Sin reembolso', tone: 'neutral' };
      }
      return null;
  }
}

/** Códigos que el sistema guarda en `reason` cuando nadie escribió un motivo. */
const SYSTEM_REASONS: Record<string, string> = {
  approval_timeout: 'Nadie respondió a tiempo',
  late_payment_no_capacity: 'El pago llegó tarde y ya no había lugar',
};

export function reasonLabel(
  r: Pick<LocalReservation, 'reason'>,
): string | null {
  if (!r.reason) return null;
  return SYSTEM_REASONS[r.reason] ?? r.reason;
}

/**
 * Las `pending_approval` que la caja no conocía: las que disparan el aviso.
 * `known = null` es "todavía no sé nada" (primera lectura sin foto previa):
 * todas cuentan como nuevas, así el operador se entera de las que ya estaban
 * esperando al abrir la caja.
 */
export function newPendingIds(
  known: ReadonlySet<string> | null,
  rows: readonly Pick<LocalReservation, 'id' | 'status'>[],
): string[] {
  return rows
    .filter(
      (r) => r.status === 'pending_approval' && !(known?.has(r.id) ?? false),
    )
    .map((r) => r.id);
}

/** Los ids que esperan respuesta: lo que queda "conocido" tras cada lectura. */
export function pendingIdSet(
  rows: readonly Pick<LocalReservation, 'id' | 'status'>[],
): Set<string> {
  return new Set(
    rows.filter((r) => r.status === 'pending_approval').map((r) => r.id),
  );
}

/** Texto del aviso de reservas nuevas por aceptar. */
export function newPendingMessage(
  rows: readonly Pick<
    LocalReservation,
    'vehiclePlate' | 'entryAt' | 'exitAt' | 'approvalDeadlineAt'
  >[],
  now: Date = new Date(),
): string {
  if (rows.length === 1) {
    const r = rows[0];
    const deadline = r.approvalDeadlineAt
      ? ` Respondé antes de las ${formatTime(r.approvalDeadlineAt)}.`
      : '';
    return `Nueva reserva por aceptar: ${r.vehiclePlate} · ${formatSlot(r.entryAt, r.exitAt, now)}.${deadline}`;
  }
  return `Hay ${rows.length} reservas nuevas por aceptar. Respondé antes de que venza el plazo.`;
}

/**
 * Códigos que no son un error de la caja sino una carrera normal: otra persona
 * (el dueño desde la web, otra caja) o el barrido la resolvió antes. No se
 * muestran como error: se avisa y se refresca la lista.
 */
const RACE_CODES = new Set([
  'RESERVATION_NOT_PENDING_APPROVAL',
  'RESERVATION_APPROVAL_EXPIRED',
  'RESERVATION_NOT_FOUND',
]);

export function classifyActionError(error: unknown): {
  message: string;
  /** La reserva ya no está como la caja la mostraba: refrescar y no insistir. */
  stale: boolean;
} {
  const code =
    error instanceof ApiError
      ? (error.problem as { code?: unknown } | null)?.code
      : undefined;
  return {
    message: translateApiError(error),
    stale: typeof code === 'string' && RACE_CODES.has(code),
  };
}
