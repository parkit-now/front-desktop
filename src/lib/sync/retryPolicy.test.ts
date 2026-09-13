import { describe, expect, it } from 'vitest';
import { ApiError } from '../api/client';
import {
  MAX_PUSH_ATTEMPTS,
  backoffDelayMs,
  classifyPushFailure,
} from './retryPolicy';

function apiError(status: number): ApiError {
  return new ApiError(status, `status ${status}`, null);
}

describe('classifyPushFailure', () => {
  it('devuelve un 401 a la cola sin gastar intentos', () => {
    // ESTE es el caso que motivó todo. Al volver la conexión el sync salía con
    // el access token vencido y cada op cosechaba un 401; el catch las mandaba
    // a `failed`, que `drainPendingOps` no vuelve a mirar nunca. El turno
    // entero del operador se perdía. Un 401 no dice nada sobre la op: la
    // credencial se arregla afuera, así que no le cobramos el intento.
    const outcome = classifyPushFailure(apiError(401), 0);

    expect(outcome.status).toBe('pending');
    expect(outcome.consumesAttempt).toBe(false);
  });

  it('reintenta el 403 pero gastando presupuesto', () => {
    // Tienta agruparlo con el 401, y es un error: el token está bien, falta el
    // permiso. Reintentamos un rato (en un cambio de turno puede entrar
    // alguien con más permisos en el mismo equipo), pero con tope, para que
    // termine visible en 'failed' y no reintentando para siempre.
    expect(classifyPushFailure(apiError(403), 3)).toMatchObject({
      status: 'pending',
      consumesAttempt: true,
    });
  });

  it('da por muerto un 403 que agotó los reintentos', () => {
    expect(
      classifyPushFailure(apiError(403), MAX_PUSH_ATTEMPTS - 1).status,
    ).toBe('failed');
  });

  it('un corte de red en medio del push no gasta intentos', () => {
    // `fetch` tira `TypeError`, no `ApiError`. La op está intacta.
    const outcome = classifyPushFailure(new TypeError('Failed to fetch'), 0);

    expect(outcome.status).toBe('pending');
    expect(outcome.consumesAttempt).toBe(false);
  });

  it('manda el 409 a conflict, no a pending', () => {
    // Reintentar el mismo payload con el mismo `expectedVersion` vuelve a dar
    // 409: sin una persona que decida, insistir es gastar batería.
    const outcome = classifyPushFailure(apiError(409), 0);

    expect(outcome.status).toBe('conflict');
    expect(outcome.consumesAttempt).toBe(true);
    expect(outcome.nextAttemptAt).toBeUndefined();
  });

  it('reintenta los 5xx con backoff y gastando intento', () => {
    const before = Date.now();
    const outcome = classifyPushFailure(apiError(503), 0);

    expect(outcome.status).toBe('pending');
    expect(outcome.consumesAttempt).toBe(true);
    expect(outcome.nextAttemptAt).toBeGreaterThanOrEqual(before);
  });

  it('reintenta timeout y rate limit', () => {
    expect(classifyPushFailure(apiError(408), 0).status).toBe('pending');
    expect(classifyPushFailure(apiError(429), 0).status).toBe('pending');
  });

  it('da por muerto un payload inválido sin reintentar', () => {
    // 400/422 no se arreglan solos: el cuerpo está mal armado.
    for (const status of [400, 404, 422]) {
      expect(classifyPushFailure(apiError(status), 0)).toMatchObject({
        status: 'failed',
        consumesAttempt: true,
      });
    }
  });

  it('corta al agotar el presupuesto de intentos', () => {
    const outcome = classifyPushFailure(apiError(503), MAX_PUSH_ATTEMPTS - 1);

    expect(outcome.status).toBe('failed');
  });

  it('no agota el presupuesto con errores que no lo consumen', () => {
    // Un 401 repetido no debe terminar enterrando la op: el presupuesto es
    // para fallos que la op podría llegar a superar sola.
    const outcome = classifyPushFailure(apiError(401), MAX_PUSH_ATTEMPTS + 5);

    expect(outcome.status).toBe('pending');
    expect(outcome.consumesAttempt).toBe(false);
  });
});

describe('backoffDelayMs', () => {
  it('crece exponencialmente', () => {
    expect(backoffDelayMs(0)).toBe(5_000);
    expect(backoffDelayMs(1)).toBe(10_000);
    expect(backoffDelayMs(2)).toBe(20_000);
  });

  it('tiene techo de 5 minutos', () => {
    // Sin techo, a los 10 intentos la espera se iría a horas y la op quedaría
    // pendiente de hecho para siempre.
    expect(backoffDelayMs(50)).toBe(5 * 60_000);
  });

  it('tolera un retryCount negativo', () => {
    expect(backoffDelayMs(-3)).toBe(5_000);
  });
});
