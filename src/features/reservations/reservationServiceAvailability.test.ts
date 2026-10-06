import { describe, expect, it } from 'vitest';
import type { ServiceCatalogItemDto } from '../../lib/api/services';
import { isReservationServiceAvailable } from './reservationServiceAvailability';

function service(
  patch: Partial<ServiceCatalogItemDto> = {},
): ServiceCatalogItemDto {
  return {
    acceptanceMode: 'auto',
    approvalWindowMinutes: 15,
    code: 'ADVANCE_RESERVATION',
    earlyArrivalMaxMinutes: 120,
    earlyArrivalMinutes: 30,
    enabled: false,
    freeCancelMinutes: 60,
    graceMinutes: 15,
    lateCancelRefundPct: 50,
    readiness: { ready: false, missing: ['mp_account'] },
    reservableSpots: null,
    reservationHoursMode: 'opening',
    reservationRateId: null,
    reservationVehicleCategories: [],
    upcomingPaidReservations: 0,
    ...patch,
  };
}

describe('isReservationServiceAvailable', () => {
  it('is available when reservations are enabled and ready', () => {
    expect(
      isReservationServiceAvailable(
        service({
          enabled: true,
          readiness: { ready: true, missing: [] },
          reservationRateId: 'rate-1',
          reservableSpots: 5,
        }),
      ),
    ).toBe(true);
  });

  it('is hidden when reservations are not configured', () => {
    expect(isReservationServiceAvailable(service())).toBe(false);
  });

  it('stays visible for already paid upcoming reservations', () => {
    expect(
      isReservationServiceAvailable(service({ upcomingPaidReservations: 1 })),
    ).toBe(true);
  });
});
