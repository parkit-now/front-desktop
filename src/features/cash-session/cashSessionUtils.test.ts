import { describe, expect, it } from 'vitest';
import type {
  LocalCashSession,
  LocalEntry,
  LocalPaymentTransaction,
} from '../../lib/db/localDb';
import {
  computeReservationsCollected,
  computeSessionStats,
  computeSessionSummary,
  computeSummariesBySession,
  pmShare,
} from './cashSessionUtils';

function tx(
  overrides: Partial<LocalPaymentTransaction> = {},
): LocalPaymentTransaction {
  return {
    id: 'tx-1',
    tenantId: 'tenant-1',
    entryId: 'entry-1',
    cashSessionId: 'session-1',
    paymentMethodName: 'Efectivo',
    paymentMethodType: 'cash',
    amount: 1000,
    version: 1,
    syncSeq: 1,
    updatedAt: '2026-09-01T12:00:00.000Z',
    ...overrides,
  };
}

function entry(overrides: Partial<LocalEntry> = {}): LocalEntry {
  return {
    id: 'entry-1',
    tenantId: 'tenant-1',
    plate: 'AA123BB',
    enteredAt: '2026-09-01T10:00:00.000Z',
    cashSessionId: 'session-1',
    version: 1,
    syncSeq: 1,
    updatedAt: '2026-09-01T12:00:00.000Z',
    ...overrides,
  };
}

function session(overrides: Partial<LocalCashSession> = {}): LocalCashSession {
  return {
    id: 'session-1',
    tenantId: 'tenant-1',
    openedAt: '2026-09-01T08:00:00.000Z',
    closedAt: '2026-09-01T16:00:00.000Z',
    openingCash: 5000,
    version: 1,
    syncSeq: 1,
    updatedAt: '2026-09-01T16:00:00.000Z',
    ...overrides,
  };
}

describe('computeSessionSummary', () => {
  it('excluye cobros dados de baja del total, efectivo y cantidad', () => {
    const summary = computeSessionSummary(
      [
        tx({ id: 'live', amount: 10 }),
        tx({ id: 'deleted', amount: 100, deletedAt: '2026-10-07T12:00:00Z' }),
      ],
      50,
    );
    expect(summary.grandTotal).toBe(10);
    expect(summary.cashTotal).toBe(60);
    expect(summary.txCount).toBe(1);
  });

  it('sin transacciones deja el total en cero y el efectivo en el fondo inicial', () => {
    const summary = computeSessionSummary([], 5000);
    expect(summary.byPm).toEqual([]);
    expect(summary.grandTotal).toBe(0);
    expect(summary.txCount).toBe(0);
    expect(summary.cashCollected).toBe(0);
    expect(summary.cashTotal).toBe(5000);
  });

  it('agrupa por medio de pago acumulando total y cantidad', () => {
    const summary = computeSessionSummary(
      [
        tx({ id: 'a', paymentMethodId: 'pm-1', amount: 1000 }),
        tx({ id: 'b', paymentMethodId: 'pm-1', amount: 500 }),
      ],
      0,
    );
    expect(summary.byPm).toHaveLength(1);
    expect(summary.byPm[0].total).toBe(1500);
    expect(summary.byPm[0].count).toBe(2);
    expect(summary.grandTotal).toBe(1500);
    expect(summary.txCount).toBe(2);
  });

  it('ordena los medios de pago por total descendente', () => {
    const summary = computeSessionSummary(
      [
        tx({
          id: 'a',
          paymentMethodId: 'pm-1',
          paymentMethodName: 'Efectivo',
          amount: 300,
        }),
        tx({
          id: 'b',
          paymentMethodId: 'pm-2',
          paymentMethodName: 'Tarjeta',
          amount: 2000,
        }),
        tx({
          id: 'c',
          paymentMethodId: 'pm-3',
          paymentMethodName: 'Transferencia',
          amount: 900,
        }),
      ],
      0,
    );
    expect(summary.byPm.map((pm) => pm.pmName)).toEqual([
      'Tarjeta',
      'Transferencia',
      'Efectivo',
    ]);
  });

  it('suma todos los medios en efectivo, no solo el primero', () => {
    const summary = computeSessionSummary(
      [
        tx({
          id: 'a',
          paymentMethodId: 'pm-1',
          paymentMethodName: 'Efectivo',
          paymentMethodType: 'cash',
          amount: 1000,
        }),
        tx({
          id: 'b',
          paymentMethodId: 'pm-2',
          paymentMethodName: 'Efectivo USD',
          paymentMethodType: 'cash',
          amount: 400,
        }),
        tx({
          id: 'c',
          paymentMethodId: 'pm-3',
          paymentMethodName: 'Tarjeta',
          paymentMethodType: 'other',
          amount: 700,
        }),
      ],
      100,
    );
    expect(summary.cashCollected).toBe(1400);
    expect(summary.cashTotal).toBe(1500);
  });

  /**
   * EL ARQUEO — lo que separa este fix del anterior.
   *
   * `computeSessionSummary` es lo que le dice al operador cuánta plata tiene
   * que haber en el cajón. Antes lo decidía por el NOMBRE del medio, y estos
   * dos casos le hacían cerrar el turno con un número equivocado.
   */
  describe('decide el efectivo por el tipo, no por el nombre', () => {
    it('un efectivo renombrado a "Caja" sigue sumando al esperado en caja', () => {
      // Con la regla vieja, estos $5.000 desaparecían del arqueo y le
      // aparecían al operador como faltante.
      const summary = computeSessionSummary(
        [
          tx({
            id: 'a',
            paymentMethodId: 'pm-1',
            paymentMethodName: 'Caja',
            paymentMethodType: 'cash',
            amount: 5000,
          }),
        ],
        1000,
      );
      expect(summary.cashCollected).toBe(5000);
      expect(summary.cashTotal).toBe(6000);
      expect(summary.byPm[0].isCash).toBe(true);
    });

    it('un "Efectivo Mercado Pago" type=other NO suma al esperado en caja', () => {
      // Esa plata está en MP. Con la regla vieja el arqueo se la reclamaba al
      // operador como si la tuviera en la mano.
      const summary = computeSessionSummary(
        [
          tx({
            id: 'a',
            paymentMethodId: 'pm-1',
            paymentMethodName: 'Efectivo Mercado Pago',
            paymentMethodType: 'other',
            amount: 5000,
          }),
        ],
        1000,
      );
      expect(summary.cashCollected).toBe(0);
      expect(summary.cashTotal).toBe(1000);
      expect(summary.grandTotal).toBe(5000);
      expect(summary.byPm[0].isCash).toBe(false);
    });

    it('una fila legacy sin tipo se sigue contando por el nombre', () => {
      // Cobros anteriores a la v13 de Dexie que todavía no volvió a bajar el
      // pull. Es plata real: perderla mientras dura esa ventana sería el
      // mismo bug.
      const summary = computeSessionSummary(
        [
          tx({
            id: 'a',
            paymentMethodId: 'pm-1',
            paymentMethodName: 'Efectivo',
            paymentMethodType: undefined,
            amount: 3000,
          }),
        ],
        0,
      );
      expect(summary.cashCollected).toBe(3000);
    });
  });

  it('distingue medios con el mismo nombre y distinto id', () => {
    const summary = computeSessionSummary(
      [
        tx({
          id: 'a',
          paymentMethodId: 'pm-1',
          paymentMethodName: 'Tarjeta',
          amount: 100,
        }),
        tx({
          id: 'b',
          paymentMethodId: 'pm-2',
          paymentMethodName: 'Tarjeta',
          amount: 200,
        }),
      ],
      0,
    );
    expect(summary.byPm).toHaveLength(2);
    expect(new Set(summary.byPm.map((pm) => pm.pmId)).size).toBe(2);
  });
});

describe('computeSummariesBySession', () => {
  it('devuelve un resumen por sesión, incluso sin cobros', () => {
    const sinCobros = session({ id: 'session-2', openingCash: 800 });
    const summaries = computeSummariesBySession(
      [session(), sinCobros],
      [tx({ id: 'a', cashSessionId: 'session-1', amount: 1200 })],
    );

    expect(summaries.get('session-1')?.grandTotal).toBe(1200);
    expect(summaries.get('session-2')?.grandTotal).toBe(0);
    expect(summaries.get('session-2')?.cashTotal).toBe(800);
  });

  it('ignora transacciones sin caja asignada', () => {
    const summaries = computeSummariesBySession(
      [session()],
      [tx({ id: 'a', cashSessionId: undefined, amount: 999 })],
    );
    expect(summaries.get('session-1')?.grandTotal).toBe(0);
  });
});

describe('computeSessionStats', () => {
  it('cuenta un pago dividido como un solo ticket', () => {
    const stats = computeSessionStats(
      session(),
      [entry({ leftAt: '2026-09-01T12:00:00.000Z' })],
      [
        tx({ id: 'a', entryId: 'entry-1', amount: 600 }),
        tx({
          id: 'b',
          entryId: 'entry-1',
          paymentMethodId: 'pm-2',
          paymentMethodName: 'Tarjeta',
          amount: 400,
        }),
      ],
    );
    expect(stats.summary.txCount).toBe(2);
    expect(stats.paidEntryCount).toBe(1);
    expect(stats.averageTicket).toBe(1000);
  });

  it('devuelve null en los promedios cuando no hay datos', () => {
    const stats = computeSessionStats(session({ closedAt: undefined }), [], []);
    expect(stats.averageTicket).toBeNull();
    expect(stats.averageStayMinutes).toBeNull();
    expect(stats.topRate).toBeNull();
  });

  it('mide el turno en curso contra el momento actual si la caja está abierta', () => {
    const abierta = computeSessionStats(
      session({ closedAt: undefined }),
      [],
      [],
      new Date('2026-09-01T10:30:00.000Z').getTime(),
    );
    expect(abierta.shiftDurationMinutes).toBe(150);

    const invalida = computeSessionStats(
      session({ openedAt: 'no-es-fecha', closedAt: undefined }),
      [],
      [],
    );
    expect(invalida.shiftDurationMinutes).toBeNull();
  });

  it('calcula duración del turno, estadía promedio y tarifa más usada', () => {
    const stats = computeSessionStats(
      session(),
      [
        entry({
          id: 'e1',
          leftAt: '2026-09-01T11:00:00.000Z',
          rateSnapshotName: 'Auto',
        }),
        entry({
          id: 'e2',
          enteredAt: '2026-09-01T10:00:00.000Z',
          leftAt: '2026-09-01T13:00:00.000Z',
          rateSnapshotName: 'Auto',
        }),
        entry({ id: 'e3', rateSnapshotName: 'Moto' }),
      ],
      [],
    );
    expect(stats.shiftDurationMinutes).toBe(480);
    expect(stats.averageStayMinutes).toBe(120);
    expect(stats.vehicleCount).toBe(3);
    expect(stats.vehiclesStillParked).toBe(1);
    expect(stats.topRate).toEqual({ name: 'Auto', count: 2 });
  });

  it('clasifica el traspaso de efectivo según el fondo dejado', () => {
    const transactions = [tx({ id: 'a', amount: 1000 })];

    const desconocido = computeSessionStats(
      session({ leavingCash: undefined }),
      [],
      transactions,
    );
    expect(desconocido.withdrawnCash).toBeNull();
    expect(desconocido.handoffStatus).toBe('unknown');

    const sinFondo = computeSessionStats(
      session({ leavingCash: 0 }),
      [],
      transactions,
    );
    expect(sinFondo.withdrawnCash).toBe(6000);
    expect(sinFondo.handoffStatus).toBe('ok');

    const excedido = computeSessionStats(
      session({ leavingCash: 9000 }),
      [],
      transactions,
    );
    expect(excedido.withdrawnCash).toBe(-3000);
    expect(excedido.handoffStatus).toBe('over');
  });
});

describe('computeReservationsCollected', () => {
  const reserved = (overrides: Partial<LocalEntry>) =>
    entry({
      reservationId: 'res-1',
      prepaidAmountArs: '1500.00',
      leftAt: '2026-09-01T12:00:00.000Z',
      ...overrides,
    });

  it('sin pagos (salida de $0) suma los que salieron dentro del turno', () => {
    expect(
      computeReservationsCollected(
        [
          reserved({ id: 'a' }),
          reserved({ id: 'b', prepaidAmountArs: '500' }),
          // Salió antes de abrir el turno y después de cerrarlo: no cuenta.
          reserved({ id: 'c', leftAt: '2026-09-01T07:00:00.000Z' }),
          reserved({ id: 'd', leftAt: '2026-09-01T17:00:00.000Z' }),
          // Sin reserva o todavía adentro: no cuenta.
          entry({ id: 'e', leftAt: '2026-09-01T12:00:00.000Z' }),
          reserved({ id: 'f', leftAt: undefined }),
        ],
        session(),
        [],
      ),
    ).toBe(2000);
  });

  it('el fin del turno es exclusivo: la salida justo al cierre es del turno siguiente', () => {
    const closed = session({ closedAt: '2026-09-01T12:00:00.000Z' });
    expect(computeReservationsCollected([reserved({})], closed, [])).toBe(0);
  });

  it('con pagos manda la caja de los pagos, aunque la ventana diga otra cosa', () => {
    const exits = [reserved({ id: 'a', cashSessionId: 'session-0' })];
    const paidInOther = [tx({ entryId: 'a', cashSessionId: 'session-2' })];
    const paidHere = [tx({ entryId: 'a', cashSessionId: 'session-1' })];
    // Salió dentro de la ventana de session-1 pero pagó en session-2.
    expect(computeReservationsCollected(exits, session(), paidInOther)).toBe(0);
    expect(computeReservationsCollected(exits, session(), paidHere)).toBe(1500);
    // Salió fuera de la ventana pero su pago quedó en este turno (offline).
    const late = [reserved({ id: 'a', leftAt: '2026-09-01T20:00:00.000Z' })];
    expect(computeReservationsCollected(late, session(), paidHere)).toBe(1500);
  });

  it('no altera el efectivo esperado ni el total del cajón', () => {
    const stats = computeSessionStats(
      session(),
      [reserved({})],
      [tx({ amount: 1000 })],
      Date.now(),
      [reserved({})],
      [tx({ amount: 1000, entryId: 'entry-1' })],
    );
    expect(stats.reservationsCollected).toBe(1500);
    expect(stats.summary.grandTotal).toBe(1000);
    expect(stats.summary.cashTotal).toBe(6000);
  });
});

describe('pmShare', () => {
  it('devuelve la proporción y evita dividir por cero', () => {
    expect(pmShare(250, 1000)).toBe(0.25);
    expect(pmShare(250, 0)).toBe(0);
    expect(pmShare(0, 0)).toBe(0);
  });
});
