import { useEffect, useState } from 'react';
import { getArcaAccount, type ArcaTaxCondition } from '../../lib/api/arca';

const cacheKey = (tenantId: string) => `parkit.desktop.arcaEmitter.${tenantId}`;

function readCache(tenantId: string): ArcaTaxCondition | null {
  try {
    const value = localStorage.getItem(cacheKey(tenantId));
    return value === 'responsable_inscripto' ||
      value === 'monotributo' ||
      value === 'exento'
      ? value
      : null;
  } catch {
    return null;
  }
}

function writeCache(tenantId: string, value: ArcaTaxCondition | null): void {
  try {
    if (value) localStorage.setItem(cacheKey(tenantId), value);
    else localStorage.removeItem(cacheKey(tenantId));
  } catch {
    // Sin storage se pierde sólo el recuerdo offline: online se vuelve a pedir.
  }
}

/**
 * Condición frente al IVA de la playa como emisora, o `null` si no factura
 * con ARCA. Decide si el cobro ofrece elegir Factura A o B (sólo un
 * Responsable Inscripto emite A).
 *
 * No es un dato operativo con sync en Dexie: cambia sólo al vincular o
 * desvincular desde el panel. Se pide al backend cuando hay red y se recuerda
 * en `localStorage`, así el cobro sin conexión sigue ofreciendo la A.
 */
export function useArcaEmitter(
  tenantId: string,
  accessToken: string,
  isOnline: boolean,
): ArcaTaxCondition | null {
  const [condition, setCondition] = useState(() => readCache(tenantId));

  useEffect(() => {
    if (!isOnline || !accessToken) return;
    let cancelled = false;
    getArcaAccount({ tenantId, bearer: accessToken })
      .then((account) => {
        const next =
          account &&
          (account.status === 'linked' || account.status === 'cert_expired')
            ? (account.condicionIva ?? null)
            : null;
        writeCache(tenantId, next);
        if (!cancelled) setCondition(next);
      })
      .catch(() => {
        // Sin respuesta se queda con lo último conocido.
      });
    return () => {
      cancelled = true;
    };
  }, [tenantId, accessToken, isOnline]);

  return condition;
}
