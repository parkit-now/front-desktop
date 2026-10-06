import type { ServiceCatalogItemDto } from '../../lib/api/services';

export const RESERVATION_SERVICE_CODE = 'ADVANCE_RESERVATION';

export function isReservationServiceAvailable(
  service: ServiceCatalogItemDto | null | undefined,
): boolean {
  if (!service) return false;

  return (
    (service.enabled && service.readiness.ready) ||
    service.upcomingPaidReservations > 0
  );
}
