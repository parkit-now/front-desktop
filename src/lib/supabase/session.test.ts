import { describe, expect, it } from 'vitest';
import { judgeCachedSession } from './session';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 8, 7, 12, 0, 0);

describe('judgeCachedSession', () => {
  it('mantiene usable una sesión validada hace un rato', () => {
    // El caso cotidiano: se cortó el Wi-Fi de la playa hace unas horas. El
    // access token ya venció, pero el operador se autenticó en este equipo y
    // tiene un auto en la barrera: echarlo al login (que sin red no puede
    // usar) convierte la app en un ladrillo.
    expect(judgeCachedSession(NOW - 6 * 60 * 60 * 1000, NOW)).toBe('usable');
  });

  it('sigue usable a los 6 días', () => {
    expect(judgeCachedSession(NOW - 6 * DAY, NOW)).toBe('usable');
  });

  it('expira pasados los 7 días', () => {
    // El tope existe para acotar el riesgo: un equipo robado o un operador
    // desvinculado no pueden seguir operando para siempre sin que el servidor
    // haya dicho nada.
    expect(judgeCachedSession(NOW - 8 * DAY, NOW)).toBe('expired');
  });

  it('no expira exactamente en el borde de los 7 días', () => {
    expect(judgeCachedSession(NOW - 7 * DAY, NOW)).toBe('usable');
    expect(judgeCachedSession(NOW - 7 * DAY - 1, NOW)).toBe('expired');
  });

  it('reporta unstamped cuando no hay sello', () => {
    // Sesión guardada por un build anterior al grace period. No es motivo para
    // expulsar a nadie: `restoreSession` arranca el reloj y sigue.
    expect(judgeCachedSession(null, NOW)).toBe('unstamped');
  });

  it('tolera un sello en el futuro (reloj del equipo cambiado)', () => {
    // En una playa el reloj de la máquina se toca. Un sello futuro da un delta
    // negativo, que NO debe leerse como vencido.
    expect(judgeCachedSession(NOW + 3 * DAY, NOW)).toBe('usable');
  });

  it('respeta una ventana explícita', () => {
    expect(judgeCachedSession(NOW - 2 * DAY, NOW, DAY)).toBe('expired');
    expect(judgeCachedSession(NOW - 2 * DAY, NOW, 30 * DAY)).toBe('usable');
  });
});
