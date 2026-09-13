import { ApiError } from '../api/client';
import type { PendingOpStatus } from '../db/localDb';

/**
 * Cuántas veces se reintenta una op antes de darla por muerta.
 *
 * Solo consumen presupuesto los fallos que la op puede llegar a resolver por sí
 * misma (5xx, timeouts). Un 401 no gasta intentos: la op está bien, lo que está
 * mal es el token, y eso se arregla afuera.
 */
export const MAX_PUSH_ATTEMPTS = 10;

const BASE_BACKOFF_MS = 5_000;
const MAX_BACKOFF_MS = 5 * 60_000;
/** Espera corta para no martillar la API mientras el token se renueva. */
const AUTH_BACKOFF_MS = 15_000;

export interface PushFailureOutcome {
  status: PendingOpStatus;
  /** Epoch ms: no reintentar antes de este momento. */
  nextAttemptAt?: number;
  /** Si el fallo gasta uno de los `MAX_PUSH_ATTEMPTS`. */
  consumesAttempt: boolean;
}

/** Backoff exponencial con techo, a partir de los intentos ya gastados. */
export function backoffDelayMs(retryCount: number): number {
  const exponent = Math.max(0, retryCount);
  return Math.min(BASE_BACKOFF_MS * 2 ** exponent, MAX_BACKOFF_MS);
}

/**
 * Decide qué hacer con una op cuyo push falló.
 *
 * El `catch` de `pushPendingOps` mandaba TODO a `failed`, que era terminal. Un
 * 401 al reconectar (recuperable: el token se renueva solo), un 409 (necesita a
 * una persona) y un payload inválido (irrecuperable) terminaban igual: la op
 * quedaba enterrada en IndexedDB para siempre y el badge de pendientes nunca
 * bajaba.
 *
 * @param error lo que tiró el handler de la op
 * @param retryCount intentos ya gastados por esta op
 */
export function classifyPushFailure(
  error: unknown,
  retryCount: number,
): PushFailureOutcome {
  const outcome = triage(error, retryCount);

  // Si gastó el presupuesto, se termina la insistencia.
  if (outcome.consumesAttempt && retryCount + 1 >= MAX_PUSH_ATTEMPTS) {
    return { status: 'failed', consumesAttempt: true };
  }

  return outcome;
}

function triage(error: unknown, retryCount: number): PushFailureOutcome {
  if (!(error instanceof ApiError)) {
    // Típicamente `TypeError: Failed to fetch`: se cortó la red en medio del
    // push. La op no tiene nada de malo, no gasta intentos.
    return {
      status: 'pending',
      nextAttemptAt: Date.now() + AUTH_BACKOFF_MS,
      consumesAttempt: false,
    };
  }

  const { status } = error;

  // Token vencido o rechazado. Se resuelve por refresh o por re-login, nunca
  // reintentando la op — así que no le cobramos el intento.
  if (status === 401) {
    return {
      status: 'pending',
      nextAttemptAt: Date.now() + AUTH_BACKOFF_MS,
      consumesAttempt: false,
    };
  }

  // 403 NO es lo mismo que 401, aunque tiente agruparlos: el token está bien,
  // lo que falta es el permiso. Un operador no se vuelve owner porque
  // reintentemos. Sí reintentamos un rato — en una playa con cambio de turno
  // puede entrar alguien con más permisos en el mismo equipo — pero gastando
  // presupuesto, para que termine en 'failed' y quede visible en vez de
  // reintentar para siempre con un badge que nunca baja.
  if (status === 403) {
    return {
      status: 'pending',
      nextAttemptAt: Date.now() + backoffDelayMs(retryCount),
      consumesAttempt: true,
    };
  }

  // Conflicto de versión: el servidor tiene algo más nuevo. Reintentar el mismo
  // payload con el mismo `expectedVersion` vuelve a dar 409 — necesita que
  // alguien decida.
  if (status === 409) {
    return { status: 'conflict', consumesAttempt: true };
  }

  // Timeout o rate limit: reintentable tal cual.
  if (status === 408 || status === 429) {
    return {
      status: 'pending',
      nextAttemptAt: Date.now() + backoffDelayMs(retryCount),
      consumesAttempt: true,
    };
  }

  // El servidor se cayó: la op sigue siendo válida.
  if (status >= 500) {
    return {
      status: 'pending',
      nextAttemptAt: Date.now() + backoffDelayMs(retryCount),
      consumesAttempt: true,
    };
  }

  // 400, 404, 422...: el payload está mal y no se arregla solo.
  return { status: 'failed', consumesAttempt: true };
}
