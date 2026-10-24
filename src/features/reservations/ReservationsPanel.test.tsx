// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../lib/api/client';
import type { OwnerReservationDto } from '../../lib/api/reservations';
import { localDb } from '../../lib/db/localDb';
import {
  change,
  cleanup,
  click,
  mount,
  pageText,
  waitForElement,
  waitForText,
} from '../../test/dom';
import { ReservationsPanel } from './ReservationsPanel';
import { useReservationsFeed } from './useReservationsFeed';

const api = vi.hoisted(() => ({
  listAllReservations: vi.fn(),
  acceptReservation: vi.fn(),
  rejectReservation: vi.fn(),
}));
const network = vi.hoisted(() => ({ isOnline: true }));

vi.mock('../../lib/api/reservations', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...api,
}));
vi.mock('../../lib/network/NetworkContext', () => ({
  useNetwork: () => ({
    isOnline: network.isOnline,
    networkUp: network.isOnline,
    backendReachable: network.isOnline,
  }),
}));

const inMinutes = (minutes: number) =>
  new Date(Date.now() + minutes * 60_000).toISOString();

function reservation(
  overrides: Partial<OwnerReservationDto> = {},
): OwnerReservationDto {
  return {
    id: 'r-pend',
    code: 'R-PEND01',
    status: 'pending_approval',
    vehiclePlate: 'PE123ND',
    vehicleCategory: 'car',
    driverName: 'Ana Pérez',
    entryAt: inMinutes(120),
    exitAt: inMinutes(240),
    createdAt: inMinutes(-10),
    paidAt: inMinutes(-9),
    approvalDeadlineAt: inMinutes(20),
    holdExpiresAt: null,
    cancelledAt: null,
    cancelledBy: null,
    reason: null,
    rateName: 'Auto',
    totalArs: 4500,
    refundStatus: 'none',
    refundedAmountArs: null,
    refundError: null,
    stay: null,
    policy: {
      acceptanceMode: 'manual',
      approvalWindowMinutes: 30,
      earlyArrivalMaxMinutes: 30,
      earlyArrivalMinutes: 15,
      freeCancelMinutes: 60,
      graceMinutes: 30,
      lateCancelRefundPct: 0,
    },
    ...overrides,
  };
}

const pending = reservation();
const confirmed = reservation({
  id: 'r-conf',
  code: 'R-CONF01',
  status: 'confirmed',
  vehiclePlate: 'CO123NF',
  approvalDeadlineAt: null,
  entryAt: inMinutes(30),
});

function Board() {
  const feed = useReservationsFeed({
    tenantId: 'tenant',
    accessToken: 'token',
  });
  return (
    <ReservationsPanel tenantId="tenant" accessToken="token" feed={feed} />
  );
}

/**
 * La base arranca vacía y el panel elige "Hoy" antes de que llegue la primera
 * lectura del servidor: se pasa a mano a las pendientes.
 */
async function openPending() {
  await waitForText('Por aceptar1');
  await click(/^Por aceptar/);
}

describe('ReservationsPanel', () => {
  let board: OwnerReservationDto[];

  beforeEach(() => {
    vi.clearAllMocks();
    network.isOnline = true;
    board = [pending, confirmed];
    api.listAllReservations.mockImplementation(
      ({ status }: { status?: string }) =>
        Promise.resolve(
          status ? board.filter((r) => r.status === status) : board,
        ),
    );
    api.acceptReservation.mockResolvedValue({
      ...pending,
      status: 'confirmed',
    });
    api.rejectReservation.mockResolvedValue({
      ...pending,
      status: 'rejected',
      refundStatus: 'pending',
    });
  });

  afterEach(async () => {
    await cleanup();
  });

  it('trae las reservas del servidor y abre en las pendientes', async () => {
    await mount(<Board />);

    await waitForText('PE123ND');
    expect(api.listAllReservations).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant', bearer: 'token' }),
    );
    expect(await localDb.reservations.count()).toBe(2);
  });

  it('acepta una reserva', async () => {
    await mount(<Board />);
    await openPending();
    await click(
      await waitForElement('[aria-label="Aceptar la reserva de PE123ND"]'),
    );

    expect(api.acceptReservation).toHaveBeenCalledWith(
      expect.objectContaining({ reservationId: 'r-pend' }),
    );
    await waitForText('Aceptaste la reserva de PE123ND.');
  });

  it('rechaza con motivo y avisa el reembolso', async () => {
    await mount(<Board />);
    await openPending();
    await click(
      await waitForElement('[aria-label="Rechazar la reserva de PE123ND"]'),
    );
    expect(pageText()).toContain('Le devolvemos');
    await change(
      document.querySelector<HTMLTextAreaElement>(
        '.rate-dialog textarea, textarea',
      )!,
      'Playa completa',
    );
    await click('Rechazar y reembolsar');

    expect(api.rejectReservation).toHaveBeenCalledWith(
      expect.objectContaining({
        reservationId: 'r-pend',
        reason: 'Playa completa',
      }),
    );
    await waitForText('Rechazaste la reserva de PE123ND.');
  });

  it('no rechaza sin motivo', async () => {
    await mount(<Board />);
    await openPending();
    await click(
      await waitForElement('[aria-label="Rechazar la reserva de PE123ND"]'),
    );
    await click('Rechazar y reembolsar');

    expect(api.rejectReservation).not.toHaveBeenCalled();
  });

  it('avisa el error al aceptar', async () => {
    api.acceptReservation.mockRejectedValue(new ApiError(500, 'boom', null));
    await mount(<Board />);
    await openPending();
    await click(
      await waitForElement('[aria-label="Aceptar la reserva de PE123ND"]'),
    );

    expect(document.querySelector('.toast-error')).toBeTruthy();
  });

  it('muestra las de hoy y las próximas en sus pestañas', async () => {
    await mount(<Board />);
    await waitForText('PE123ND');

    await click(/^Hoy/);
    await waitForText('CO123NF');
    await click(/^Próximas/);
    expect(pageText()).toContain('No hay reservas próximas');
  });

  it('sin conexión no acepta y explica por qué', async () => {
    await localDb.reservations.put({
      ...pending,
      tenantId: 'tenant',
      driverName: 'Ana Pérez',
      approvalDeadlineAt: pending.approvalDeadlineAt ?? undefined,
      reason: undefined,
      cancelledBy: undefined,
      refundedAmountArs: undefined,
      fetchedAt: new Date().toISOString(),
    } as never);
    network.isOnline = false;
    await mount(<Board />);
    await waitForText('PE123ND');

    expect(api.listAllReservations).not.toHaveBeenCalled();
  });

  it('se puede actualizar a mano', async () => {
    await mount(<Board />);
    await waitForText('PE123ND');
    board = [...board, reservation({ id: 'r-new', vehiclePlate: 'NU123EV' })];

    await click('Actualizar');

    await waitForText('NU123EV');
  });
});
