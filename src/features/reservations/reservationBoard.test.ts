import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../lib/api/client';
import type { LocalReservation } from '../../lib/db/localDb';

vi.mock('../../lib/db/localDb', () => ({ localDb: {} }));

const {
  actionState,
  availableActions,
  bucketOf,
  classifyActionError,
  countByBucket,
  countdownTo,
  formatSlot,
  isBoardStatus,
  newPendingIds,
  newPendingMessage,
  OFFLINE_ACTIONS_MESSAGE,
  pendingCount,
  pendingIdSet,
  reasonLabel,
  refundChip,
  rowsOf,
  statusChip,
} = await import('./reservationBoard');

// 13:00 en Buenos Aires.
const NOW_DATE = new Date('2026-10-03T16:00:00Z');
const NOW = NOW_DATE.getTime();

function res(patch: Partial<LocalReservation> = {}): LocalReservation {
  return {
    id: 'r1',
    tenantId: 't1',
    code: 'R-4F2K9A',
    status: 'confirmed',
    vehiclePlate: 'AB123CD',
    driverName: 'Lucía M.',
    entryAt: '2026-10-03T21:00:00Z', // hoy 18:00
    exitAt: '2026-10-04T00:00:00Z',
    totalArs: 4500,
    refundStatus: 'none',
    fetchedAt: '2026-10-03T16:00:00Z',
    ...patch,
  };
}

const TOMORROW = '2026-10-04T12:00:00Z'; // mañana 09:00
const YESTERDAY = '2026-10-02T21:00:00Z';

describe('availableActions (estado → acciones)', () => {
  it('por aceptar a tiempo: aceptar y rechazar', () => {
    const r = res({
      status: 'pending_approval',
      approvalDeadlineAt: new Date(NOW + 60_000).toISOString(),
    });
    expect(availableActions(r, NOW)).toEqual(['accept', 'reject']);
  });

  it('por aceptar vencida: sólo rechazar (aceptar ya no se puede)', () => {
    const r = res({
      status: 'pending_approval',
      approvalDeadlineAt: new Date(NOW - 1000).toISOString(),
    });
    expect(availableActions(r, NOW)).toEqual(['reject']);
  });

  it('el resto de los estados: nada desde la caja', () => {
    for (const status of [
      'confirmed',
      'checked_in',
      'completed',
      'rejected',
      'cancelled',
      'no_show',
    ] as const) {
      expect(availableActions(res({ status }), NOW)).toEqual([]);
    }
  });

  it('un reembolso fallido no suma acciones: lo reintenta el dueño en la web', () => {
    expect(
      availableActions(
        res({ status: 'cancelled', refundStatus: 'failed' }),
        NOW,
      ),
    ).toEqual([]);
  });
});

describe('actionState (sin conexión)', () => {
  const pending = res({
    status: 'pending_approval',
    approvalDeadlineAt: new Date(NOW + 600_000).toISOString(),
  });

  it('con conexión, las acciones se pueden usar', () => {
    expect(actionState(pending, true, NOW)).toEqual({
      actions: ['accept', 'reject'],
      disabled: false,
      disabledReason: null,
    });
  });

  it('sin conexión se ven pero quedan bloqueadas, con el motivo', () => {
    expect(actionState(pending, false, NOW)).toEqual({
      actions: ['accept', 'reject'],
      disabled: true,
      disabledReason: OFFLINE_ACTIONS_MESSAGE,
    });
    expect(OFFLINE_ACTIONS_MESSAGE).toBe(
      'Sin conexión: no se puede aceptar ni rechazar.',
    );
  });

  it('sin acciones no hay nada que bloquear', () => {
    expect(actionState(res(), false, NOW)).toEqual({
      actions: [],
      disabled: false,
      disabledReason: null,
    });
  });
});

describe('bucketOf (pestañas)', () => {
  it('por aceptar, sea del día que sea', () => {
    expect(bucketOf(res({ status: 'pending_approval' }), NOW_DATE)).toBe(
      'pending',
    );
    expect(
      bucketOf(
        res({ status: 'pending_approval', entryAt: TOMORROW }),
        NOW_DATE,
      ),
    ).toBe('pending');
  });

  it('confirmadas: hoy (o atrasadas) en Hoy, de mañana en adelante en Próximas', () => {
    expect(bucketOf(res(), NOW_DATE)).toBe('today');
    expect(bucketOf(res({ entryAt: YESTERDAY }), NOW_DATE)).toBe('today');
    expect(bucketOf(res({ entryAt: TOMORROW }), NOW_DATE)).toBe('upcoming');
  });

  it('usa el día de Buenos Aires, no el UTC', () => {
    // 22:30 de hoy en Argentina = 01:30 UTC de mañana.
    expect(bucketOf(res({ entryAt: '2026-10-04T01:30:00Z' }), NOW_DATE)).toBe(
      'today',
    );
    // 00:30 de mañana en Argentina.
    expect(bucketOf(res({ entryAt: '2026-10-04T03:30:00Z' }), NOW_DATE)).toBe(
      'upcoming',
    );
  });

  it('en curso siempre en Hoy, aunque haya entrado ayer', () => {
    expect(
      bucketOf(res({ status: 'checked_in', entryAt: YESTERDAY }), NOW_DATE),
    ).toBe('today');
  });

  it('las resueltas sólo si son de hoy', () => {
    for (const status of [
      'completed',
      'no_show',
      'rejected',
      'cancelled',
    ] as const) {
      expect(bucketOf(res({ status }), NOW_DATE)).toBe('today');
      expect(bucketOf(res({ status, entryAt: TOMORROW }), NOW_DATE)).toBeNull();
    }
  });

  it('las que nunca se pagaron no se muestran', () => {
    expect(bucketOf(res({ status: 'pending_payment' }), NOW_DATE)).toBeNull();
    expect(bucketOf(res({ status: 'expired' }), NOW_DATE)).toBeNull();
    expect(isBoardStatus('pending_payment')).toBe(false);
    expect(isBoardStatus('expired')).toBe(false);
    expect(isBoardStatus('rejected')).toBe(true);
  });

  it('cuenta por pestaña', () => {
    expect(
      countByBucket(
        [
          res({ status: 'pending_approval' }),
          res({ status: 'pending_approval', entryAt: TOMORROW }),
          res(),
          res({ status: 'checked_in' }),
          res({ entryAt: TOMORROW }),
          res({ status: 'expired' }),
          res({ status: 'rejected', entryAt: TOMORROW }),
        ],
        NOW_DATE,
      ),
    ).toEqual({ pending: 2, today: 2, upcoming: 1 });
  });

  it('ordena: por aceptar por plazo, el resto por hora de ingreso', () => {
    const rows = [
      res({
        id: 'b',
        status: 'pending_approval',
        approvalDeadlineAt: '2026-10-03T16:10:00Z',
      }),
      res({
        id: 'a',
        status: 'pending_approval',
        approvalDeadlineAt: '2026-10-03T16:05:00Z',
      }),
      res({ id: 'late', entryAt: '2026-10-03T23:00:00Z' }),
      res({ id: 'early', entryAt: '2026-10-03T18:00:00Z' }),
    ];
    expect(rowsOf(rows, 'pending', NOW_DATE).map((r) => r.id)).toEqual([
      'a',
      'b',
    ]);
    expect(rowsOf(rows, 'today', NOW_DATE).map((r) => r.id)).toEqual([
      'early',
      'late',
    ]);
  });
});

describe('pendingCount (badge)', () => {
  it('cuenta las por aceptar a tiempo; las vencidas de una foto vieja no', () => {
    expect(
      pendingCount(
        [
          res({
            status: 'pending_approval',
            approvalDeadlineAt: new Date(NOW + 1000).toISOString(),
          }),
          res({
            status: 'pending_approval',
            approvalDeadlineAt: new Date(NOW - 1000).toISOString(),
          }),
          res({ status: 'confirmed' }),
        ],
        NOW,
      ),
    ).toBe(1);
  });
});

describe('countdownTo', () => {
  it('formatea mm:ss', () => {
    expect(
      countdownTo(new Date(NOW + (14 * 60 + 12) * 1000).toISOString(), NOW),
    ).toMatchObject({ label: '14:12', expired: false, urgent: false });
  });

  it('urgente bajo los 3 minutos', () => {
    const c = countdownTo(new Date(NOW + 179_000).toISOString(), NOW);
    expect(c).toMatchObject({ label: '02:59', urgent: true });
  });

  it('redondea hacia arriba: nunca 00:00 antes de vencer', () => {
    expect(countdownTo(new Date(NOW + 400).toISOString(), NOW)?.label).toBe(
      '00:01',
    );
  });

  it('vencido', () => {
    expect(countdownTo(new Date(NOW).toISOString(), NOW)).toEqual({
      label: '00:00',
      remainingMs: 0,
      expired: true,
      urgent: true,
    });
  });

  it('sin plazo, null; más de una hora, h:mm:ss', () => {
    expect(countdownTo(undefined, NOW)).toBeNull();
    expect(
      countdownTo(new Date(NOW + 3_723_000).toISOString(), NOW)?.label,
    ).toBe('1:02:03');
  });
});

describe('formatSlot', () => {
  it('hoy, mañana y otra fecha', () => {
    expect(
      formatSlot('2026-10-03T21:00:00Z', '2026-10-04T00:00:00Z', NOW_DATE),
    ).toBe('Hoy 18:00–21:00');
    expect(
      formatSlot('2026-10-04T12:00:00Z', '2026-10-04T15:00:00Z', NOW_DATE),
    ).toBe('Mañana 09:00–12:00');
    expect(
      formatSlot('2026-10-09T12:00:00Z', '2026-10-09T15:00:00Z', NOW_DATE),
    ).toBe('09/10 09:00–12:00');
  });

  it('cruza la medianoche', () => {
    expect(
      formatSlot('2026-10-04T01:00:00Z', '2026-10-04T07:00:00Z', NOW_DATE),
    ).toBe('Hoy 22:00 – Mañana 04:00');
  });
});

describe('chips', () => {
  it('estado: en la caja el dueño es "la playa"', () => {
    expect(
      statusChip(res({ status: 'cancelled', cancelledBy: 'owner' })).label,
    ).toBe('Cancelada · playa');
    expect(
      statusChip(res({ status: 'rejected', cancelledBy: 'owner' })).label,
    ).toBe('Rechazada');
    expect(
      statusChip(res({ status: 'rejected', cancelledBy: 'system' })).label,
    ).toBe('Vencida sin respuesta');
    expect(statusChip(res({ status: 'pending_approval' }))).toEqual({
      label: 'Por aceptar',
      tone: 'warn',
    });
  });

  it('en curso dice si llegó antes o tarde (6c)', () => {
    expect(statusChip(res({ status: 'checked_in' })).label).toBe('En curso');
    expect(
      statusChip(res({ status: 'checked_in', arrival: 'on_time' })).label,
    ).toBe('En curso');
    expect(
      statusChip(res({ status: 'checked_in', arrival: 'early' })).label,
    ).toBe('En curso · llegó antes');
    expect(
      statusChip(res({ status: 'checked_in', arrival: 'late' })).label,
    ).toBe('En curso · llegó tarde');
    // Ya salió: la llegada no cambia el estado final.
    expect(
      statusChip(res({ status: 'completed', arrival: 'early' })).label,
    ).toBe('Completada');
  });

  it('reembolso', () => {
    expect(refundChip(res({ refundStatus: 'refunded' }))?.label).toBe(
      'Reembolsada',
    );
    expect(refundChip(res({ refundStatus: 'pending' }))?.label).toBe(
      'Reembolso en curso',
    );
    expect(refundChip(res({ refundStatus: 'failed' }))?.tone).toBe('err');
    expect(refundChip(res({ status: 'no_show' }))?.label).toBe('Sin reembolso');
    expect(refundChip(res())).toBeNull();
  });

  it('motivo: traduce los del sistema, respeta el texto libre', () => {
    expect(reasonLabel(res({ reason: 'approval_timeout' }))).toBe(
      'Nadie respondió a tiempo',
    );
    expect(reasonLabel(res({ reason: 'Corte de luz' }))).toBe('Corte de luz');
    expect(reasonLabel(res())).toBeNull();
  });
});

describe('aviso de reservas nuevas por aceptar', () => {
  const p = (id: string) => res({ id, status: 'pending_approval' });

  it('sin foto previa, todas las por aceptar son nuevas', () => {
    expect(newPendingIds(null, [p('a'), p('b'), res({ id: 'c' })])).toEqual([
      'a',
      'b',
    ]);
  });

  it('sólo avisa las que no conocía', () => {
    const known = pendingIdSet([p('a'), res({ id: 'c' })]);
    expect([...known]).toEqual(['a']);
    expect(newPendingIds(known, [p('a'), p('b')])).toEqual(['b']);
  });

  it('una que se resolvió y desaparece no avisa nada', () => {
    expect(newPendingIds(new Set(['a', 'b']), [p('a')])).toEqual([]);
  });

  it('una aceptada en otro lado deja de estar por aceptar: no es nueva', () => {
    expect(
      newPendingIds(new Set(['a']), [res({ id: 'a', status: 'confirmed' })]),
    ).toEqual([]);
  });

  it('el texto nombra la patente, la franja y el plazo', () => {
    expect(
      newPendingMessage(
        [
          res({
            status: 'pending_approval',
            approvalDeadlineAt: '2026-10-03T16:15:00Z',
          }),
        ],
        NOW_DATE,
      ),
    ).toBe(
      'Nueva reserva por aceptar: AB123CD · Hoy 18:00–21:00. Respondé antes de las 13:15.',
    );
    expect(newPendingMessage([p('a'), p('b')], NOW_DATE)).toContain(
      'Hay 2 reservas nuevas por aceptar',
    );
  });
});

describe('classifyActionError (carreras con la web)', () => {
  const apiError = (code: string, status = 409) =>
    new ApiError(status, 'x', {
      title: 'Conflict',
      status,
      detail: 'x',
      instance: '/x',
      code,
    });

  it('ya resuelta en otro lado: no es un error, se refresca', () => {
    const r = classifyActionError(apiError('RESERVATION_NOT_PENDING_APPROVAL'));
    expect(r.stale).toBe(true);
    expect(r.message).toContain('ya no está esperando respuesta');
  });

  it('vencida y no encontrada también son carreras', () => {
    expect(
      classifyActionError(apiError('RESERVATION_APPROVAL_EXPIRED')).stale,
    ).toBe(true);
    expect(
      classifyActionError(apiError('RESERVATION_NOT_FOUND', 404)).stale,
    ).toBe(true);
  });

  it('el resto es un error de verdad, traducido', () => {
    const r = classifyActionError(apiError('RESERVATION_REASON_REQUIRED', 400));
    expect(r).toEqual({
      stale: false,
      message: 'Escribí el motivo para continuar.',
    });
    expect(classifyActionError(new TypeError('fetch')).message).toContain(
      'No pudimos conectarnos',
    );
  });
});
