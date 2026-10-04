import { beforeEach, describe, expect, it, vi } from 'vitest';

const { listAllReservations } = vi.hoisted(() => ({
  listAllReservations: vi.fn(),
}));
vi.mock('../api/reservations', () => ({ listAllReservations }));
vi.mock('../db/localDb', () => ({ localDb: {} }));

const { fetchReservations, toLocalReservation } =
  await import('./reservationsSnapshot');

const base = {
  id: 'r-1',
  code: 'R-ABC123',
  status: 'pending_approval',
  vehiclePlate: 'AB123CD',
  vehicleCategory: 'car',
  driverName: 'Lucía',
  entryAt: '2026-10-06T21:00:00.000Z',
  exitAt: '2026-10-07T00:00:00.000Z',
  totalArs: 4500,
  approvalDeadlineAt: '2026-10-06T16:15:00.000Z',
  refundStatus: 'none',
  refundedAmountArs: null,
  reason: null,
  cancelledBy: null,
  stay: null,
};

describe('toLocalReservation', () => {
  it('guarda el plazo, el reembolso y la hora de ingreso del auto', () => {
    const row = toLocalReservation(
      {
        ...base,
        status: 'checked_in',
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
      approvalDeadlineAt: '2026-10-06T16:15:00.000Z',
      refundStatus: 'none',
      enteredAt: '2026-10-06T20:52:00.000Z',
      fetchedAt: '2026-10-06T21:00:00.000Z',
    });
    // Los null del contrato quedan como campos ausentes.
    expect(row.reason).toBeUndefined();
    expect(row.cancelledBy).toBeUndefined();
  });

  it('guarda cómo llegó el auto vinculado (6c)', () => {
    const row = toLocalReservation(
      {
        ...base,
        status: 'checked_in',
        stay: {
          entryId: 'e-1',
          enteredAt: '2026-10-06T20:10:00.000Z',
          leftAt: null,
          excessChargedArs: null,
          prepaidAmountArs: 4500,
          arrival: 'early',
          minutesEarly: 50,
          minutesLate: 0,
        },
      } as never,
      'tenant-1',
      'x',
    );
    expect(row).toMatchObject({
      stayEntryId: 'e-1',
      arrival: 'early',
      minutesEarly: 50,
      minutesLate: 0,
    });
  });

  it('un backend de la fase 6 (stay sin arrival) no inventa la llegada', () => {
    const row = toLocalReservation(
      {
        ...base,
        status: 'checked_in',
        stay: {
          entryId: 'e-1',
          enteredAt: '2026-10-06T20:52:00.000Z',
          leftAt: null,
          excessChargedArs: null,
          prepaidAmountArs: 4500,
        },
      } as never,
      'tenant-1',
      'x',
    );
    expect(row.arrival).toBeUndefined();
    expect(row.stayEntryId).toBe('e-1');
  });

  it('un backend sin `stay` (anterior a la fase 6) no rompe', () => {
    const withoutStay: Partial<typeof base> = { ...base };
    delete withoutStay.stay;
    const row = toLocalReservation(withoutStay as never, 'tenant-1', 'x');
    expect(row.enteredAt).toBeUndefined();
  });
});

describe('fetchReservations', () => {
  beforeEach(() => {
    listAllReservations.mockReset();
  });

  it('junta las vivas y las de hoy, sin repetir ni las sin pagar', async () => {
    listAllReservations.mockImplementation(
      (input: { status?: string; from?: string }) => {
        if (input.status === 'pending_approval') return Promise.resolve([base]);
        if (input.status === 'confirmed')
          return Promise.resolve([{ ...base, id: 'r-2', status: 'confirmed' }]);
        if (input.status === 'checked_in') return Promise.resolve([]);
        // Las de hoy, en cualquier estado: repite r-2 y trae resueltas.
        return Promise.resolve([
          { ...base, id: 'r-2', status: 'confirmed' },
          { ...base, id: 'r-3', status: 'rejected', refundStatus: 'refunded' },
          { ...base, id: 'r-4', status: 'expired' },
          { ...base, id: 'r-5', status: 'pending_payment' },
        ]);
      },
    );

    const rows = await fetchReservations({
      tenantId: 't-1',
      bearer: 'tok',
      now: new Date('2026-10-06T16:00:00Z'),
    });

    expect(rows.map((r) => r.id).sort()).toEqual(['r-1', 'r-2', 'r-3']);
    // Tres estados vivos + el rango de hoy (00:00 a 23:59:59.999 de Buenos Aires).
    expect(listAllReservations).toHaveBeenCalledTimes(4);
    expect(listAllReservations).toHaveBeenCalledWith({
      tenantId: 't-1',
      bearer: 'tok',
      from: '2026-10-06T03:00:00.000Z',
      to: '2026-10-07T02:59:59.999Z',
    });
  });
});
