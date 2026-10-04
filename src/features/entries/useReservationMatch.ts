import { useEffect, useState } from 'react';
import {
  matchReservation,
  type ReservationMatchDto,
} from '../../lib/api/reservations';
import { matchesPlate, normalizePlate } from './reservationUtils';

/** Espera después de la última tecla antes de preguntarle al backend. */
export const MATCH_DEBOUNCE_MS = 400;

/** Una patente más corta no identifica a nadie: no se consulta. */
const MIN_PLATE_LENGTH = 3;

export type ReservationMatchState = {
  /** La reserva a la que se vincularía el ingreso de ahora (banner). */
  match: ReservationMatchDto | null;
  /**
   * Fase 6c: una reserva de HOY de esa patente a la que todavía es muy
   * temprano para vincular (aviso "tiene una reserva hoy a las HH:MM").
   */
  upcoming: ReservationMatchDto | null;
};

const EMPTY: ReservationMatchState = { match: null, upcoming: null };

/**
 * La reserva de la patente que se está cargando (banner "Tiene reserva").
 *
 * Sólo con conexión: sin red no hay banner, y el backend vincula el ingreso
 * por patente cuando la caja sincroniza. Cualquier error (sin red a mitad de
 * camino, o un backend anterior a la fase 6, que responde 400 a esta ruta) se
 * trata como "sin reserva": el banner es una ayuda, nunca frena un ingreso.
 *
 * Devuelve el match sólo si sigue siendo de la patente tipeada: si el operador
 * corrigió la patente mientras volvía la respuesta, la vieja no se muestra ni
 * se manda con el ingreso.
 */
export function useReservationMatch(input: {
  tenantId: string;
  accessToken: string;
  plate: string;
  enabled: boolean;
}): ReservationMatchState {
  const { tenantId, accessToken, plate, enabled } = input;
  const [state, setState] = useState<ReservationMatchState>(EMPTY);
  const normalized = normalizePlate(plate);

  useEffect(() => {
    if (!enabled || normalized.length < MIN_PLATE_LENGTH) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      matchReservation({ tenantId, bearer: accessToken, plate: normalized })
        .then((response) => {
          if (cancelled) return;
          setState({
            match: response.reservation ?? null,
            // Un backend anterior a la 6c no lo manda.
            upcoming: response.upcomingToday ?? null,
          });
        })
        .catch(() => {
          if (!cancelled) setState(EMPTY);
        });
    }, MATCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [tenantId, accessToken, normalized, enabled]);

  if (!enabled) return EMPTY;
  return {
    match: matchesPlate(state.match, plate) ? state.match : null,
    upcoming: matchesPlate(state.upcoming, plate) ? state.upcoming : null,
  };
}
