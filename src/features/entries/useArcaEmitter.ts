import { useEffect, useState } from 'react';
import {
  getArcaAccount,
  type ArcaAccountDto,
  type ArcaTaxCondition,
} from '../../lib/api/arca';

/** La playa como emisora de facturas, en lo que le importa al cobro. */
export interface ArcaEmitter {
  /** Decide la letra: sólo un Responsable Inscripto ofrece elegir A o B. */
  readonly condicionIva: ArcaTaxCondition;
  /** Venció el certificado: la facturación está pausada hasta renovarlo. */
  readonly certExpired: boolean;
}

const CONDITIONS: readonly ArcaTaxCondition[] = [
  'responsable_inscripto',
  'monotributo',
  'exento',
];

const cacheKey = (tenantId: string) => `parkit.desktop.arcaEmitter.${tenantId}`;

/**
 * La cuenta de ARCA vista desde el cobro, o `null` si la playa no factura.
 * Una cuenta `linked` cuyo certificado ya venció cuenta como pausada aunque
 * el job diario todavía no la haya marcado `cert_expired`.
 */
export function toArcaEmitter(
  account: Pick<
    ArcaAccountDto,
    'status' | 'condicionIva' | 'certExpiresAt'
  > | null,
  now: Date = new Date(),
): ArcaEmitter | null {
  if (
    !account?.condicionIva ||
    (account.status !== 'linked' && account.status !== 'cert_expired')
  ) {
    return null;
  }
  const expiresAt = account.certExpiresAt
    ? new Date(account.certExpiresAt).getTime()
    : Number.NaN;
  return {
    condicionIva: account.condicionIva,
    certExpired:
      account.status === 'cert_expired' ||
      (!Number.isNaN(expiresAt) && expiresAt <= now.getTime()),
  };
}

/**
 * Lee lo guardado en `localStorage`. Acepta también el formato viejo (sólo la
 * condición como texto), así una actualización no pierde el dato offline.
 */
export function parseEmitterCache(raw: string | null): ArcaEmitter | null {
  if (!raw) return null;
  if (CONDITIONS.includes(raw as ArcaTaxCondition)) {
    return { condicionIva: raw as ArcaTaxCondition, certExpired: false };
  }
  try {
    const value = JSON.parse(raw) as Partial<ArcaEmitter>;
    return value.condicionIva && CONDITIONS.includes(value.condicionIva)
      ? {
          condicionIva: value.condicionIva,
          certExpired: value.certExpired === true,
        }
      : null;
  } catch {
    return null;
  }
}

function readCache(tenantId: string): ArcaEmitter | null {
  try {
    return parseEmitterCache(localStorage.getItem(cacheKey(tenantId)));
  } catch {
    return null;
  }
}

function writeCache(tenantId: string, value: ArcaEmitter | null): void {
  try {
    if (value) localStorage.setItem(cacheKey(tenantId), JSON.stringify(value));
    else localStorage.removeItem(cacheKey(tenantId));
  } catch {
    // Sin storage se pierde sólo el recuerdo offline: online se vuelve a pedir.
  }
}

/**
 * La playa como emisora, o `null` si no factura con ARCA. Decide si el cobro
 * ofrece elegir Factura A o B (sólo un Responsable Inscripto emite A) y si
 * avisa que la facturación está pausada por el certificado vencido.
 *
 * No es un dato operativo con sync en Dexie: cambia sólo al vincular,
 * renovar o desvincular desde el panel. Se pide al backend cuando hay red y
 * se recuerda en `localStorage`, así el cobro sin conexión sigue igual.
 */
export function useArcaEmitter(
  tenantId: string,
  accessToken: string,
  isOnline: boolean,
): ArcaEmitter | null {
  const [emitter, setEmitter] = useState(() => readCache(tenantId));

  useEffect(() => {
    if (!isOnline || !accessToken) return;
    let cancelled = false;
    getArcaAccount({ tenantId, bearer: accessToken })
      .then((account) => {
        const next = toArcaEmitter(account);
        writeCache(tenantId, next);
        if (!cancelled) setEmitter(next);
      })
      .catch(() => {
        // Sin respuesta se queda con lo último conocido.
      });
    return () => {
      cancelled = true;
    };
  }, [tenantId, accessToken, isOnline]);

  return emitter;
}
