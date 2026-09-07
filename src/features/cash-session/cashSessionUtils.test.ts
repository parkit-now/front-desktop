import { describe, expect, it } from 'vitest';
import type {
  LocalCashSession,
  LocalEntry,
  LocalPaymentTransaction,
} from '../../lib/db/localDb';
import {
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
          amount: 1000,
        }),
        tx({
          id: 'b',
          paymentMethodId: 'pm-2',
          paymentMethodName: 'Efectivo USD',
          amount: 400,
        }),
        tx({
          id: 'c',
          paymentMethodId: 'pm-3',
          paymentMethodName: 'Tarjeta',
          amount: 700,
        }),
      ],
      100,
    );
    expect(summary.cashCollected).toBe(1400);
    expect(summary.cashTotal).toBe(1500);
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

describe('pmShare', () => {
  it('devuelve la proporción y evita dividir por cero', () => {
    expect(pmShare(250, 1000)).toBe(0.25);
    expect(pmShare(250, 0)).toBe(0);
    expect(pmShare(0, 0)).toBe(0);
  });
});
