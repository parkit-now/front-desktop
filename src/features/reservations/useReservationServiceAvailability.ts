import { useEffect, useState } from 'react';
import { listServices } from '../../lib/api/services';
import { useNetwork } from '../../lib/network/NetworkContext';
import {
  isReservationServiceAvailable,
  RESERVATION_SERVICE_CODE,
} from './reservationServiceAvailability';

function storageKey(tenantId: string): string {
  return `parkit.desktop.reservations.available:${tenantId}`;
}

function readCachedAvailability(tenantId: string): boolean | null {
  if (typeof window === 'undefined') return null;
  const value = window.localStorage.getItem(storageKey(tenantId));
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
}

function writeCachedAvailability(tenantId: string, available: boolean): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(storageKey(tenantId), String(available));
}

export function useReservationServiceAvailability(input: {
  tenantId: string | null;
  accessToken: string;
}): boolean {
  const { tenantId, accessToken } = input;
  const { isOnline } = useNetwork();
  const [available, setAvailable] = useState<boolean | null>(() =>
    tenantId ? readCachedAvailability(tenantId) : false,
  );

  useEffect(() => {
    setAvailable(tenantId ? readCachedAvailability(tenantId) : false);
  }, [tenantId]);

  useEffect(() => {
    if (!tenantId || !isOnline) return;

    let mounted = true;
    void listServices({ tenantId, bearer: accessToken })
      .then((services) => {
        if (!mounted) return;
        const service = services.find(
          (item) => item.code === RESERVATION_SERVICE_CODE,
        );
        const nextAvailable = isReservationServiceAvailable(service);
        writeCachedAvailability(tenantId, nextAvailable);
        setAvailable(nextAvailable);
      })
      .catch(() => undefined);

    return () => {
      mounted = false;
    };
  }, [accessToken, isOnline, tenantId]);

  return available === true;
}
