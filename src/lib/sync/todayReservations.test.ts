import { describe, expect, it, vi } from 'vitest';

vi.mock('../db/localDb', () => ({ localDb: {} }));

const { toLocalTodayReservation } = await import('./todayReservations');

describe('toLocalTodayReservation', () => {
  const base = {
    id: 'r-1',
    code: 'R-ABC123',
    status: 'checked_in',
    vehiclePlate: 'AB123CD',
    driverName: 'Lucía',
    entryAt: '2026-10-06T21:00:00.000Z',
    exitAt: '2026-10-07T00:00:00.000Z',
    totalArs: 4500,
  };

  it('guarda la reserva con la hora de ingreso del auto', () => {
    const row = toLocalTodayReservation(
      {
        ...base,
        stay: {
          entryId: 'e-1',
          enteredAt: '2026-10-06T20:52:00.000Z',
          leftAt: null,
          excessChargedArs: null,
          prepaidAmountArs: 4500,
        },
      } as never,
      'tenant-1',
      '2026-10-06T21:00:00.000Z',
    );
    expect(row).toMatchObject({
      id: 'r-1',
      tenantId: 'tenant-1',
      status: 'checked_in',
      enteredAt: '2026-10-06T20:52:00.000Z',
      fetchedAt: '2026-10-06T21:00:00.000Z',
    });
  });

  it('un backend sin `stay` (anterior a la fase 6) no rompe', () => {
    const row = toLocalTodayReservation(base as never, 'tenant-1', 'x');
    expect(row.enteredAt).toBeUndefined();
  });
});
