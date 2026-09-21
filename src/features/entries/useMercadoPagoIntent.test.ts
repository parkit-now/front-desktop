import { describe, expect, it } from 'vitest';
import { describeIntentState, secondsLeft } from './useMercadoPagoIntent';

describe('useMercadoPagoIntent', () => {
  /**
   * LA CUENTA REGRESIVA — el único reloj que el operario ve.
   *
   * No decide nada (el que vence el cobro es el backend, perezosamente, en el
   * GET), pero sí es lo que mira para saber si le pide paciencia al cliente o
   * ya le cobra en efectivo. Un contador que se va a negativo le dice que la
   * app se rompió, cuando lo único que pasó es que el cobro venció.
   */
  describe('secondsLeft', () => {
    it('cuenta hacia abajo y nunca baja de cero', () => {
      const now = Date.parse('2026-09-21T03:00:00.000Z');
      const expiresAt = '2026-09-21T03:05:00.000Z'; // el TTL real: 5 minutos

      expect(secondsLeft(expiresAt, now)).toBe(300);
      expect(secondsLeft(expiresAt, now + 60_000)).toBe(240);
      expect(secondsLeft(expiresAt, now + 299_000)).toBe(1);

      // Ceil y no floor: recién creado, el operario tiene que leer 5:00.
      expect(secondsLeft(expiresAt, now + 600)).toBe(300);

      // Justo en el vencimiento y después: cero, nunca negativo.
      expect(secondsLeft(expiresAt, now + 300_000)).toBe(0);
      expect(secondsLeft(expiresAt, now + 900_000)).toBe(0);

      // Sin fecha o con una fecha basura tampoco inventamos tiempo.
      expect(secondsLeft(undefined, now)).toBe(0);
      expect(secondsLeft(null, now)).toBe(0);
      expect(secondsLeft('no es una fecha', now)).toBe(0);
    });
  });

  /**
   * ESTADO → QUÉ LEE EL OPERARIO.
   *
   * Los tres casos que más fácil se explican mal, y que si se explican mal
   * terminan con el operario diciéndole algo falso a un cliente que tiene
   * enfrente.
   */
  describe('describeIntentState', () => {
    it('approved habilita cerrar la estadía; expired y failed ofrecen salida sin mentir', () => {
      const approved = describeIntentState('approved');
      expect(approved.canConfirm).toBe(true);
      expect(approved.canCancel).toBe(false);
      expect(approved.showCountdown).toBe(false);

      // 🔴 Vencer NO es "el pago fue rechazado". En QR, Mercado Pago no expone
      // los rechazos: un cliente que nunca escaneó y una tarjeta que rebotó
      // son el mismo silencio. Prometer una causa que nadie nos informó
      // mandaría al operario a pedir otra tarjeta al pedo.
      const expired = describeIntentState('expired');
      expect(expired.canRetry).toBe(true);
      expect(expired.canConfirm).toBe(false);
      expect(expired.showCountdown).toBe(false);
      expect(`${expired.title} ${expired.detail}`.toLowerCase()).not.toContain(
        'rechaz',
      );

      // 🔴 `failed` tampoco significa que el cliente no pagó: significa que no
      // pudimos ni crear la orden, así que nunca vio un importe. No hay nada
      // que reclamarle.
      const failed = describeIntentState('failed');
      expect(failed.tone).toBe('error');
      expect(failed.canRetry).toBe(true);
      expect(failed.canConfirm).toBe(false);
      expect(`${failed.title} ${failed.detail}`.toLowerCase()).not.toContain(
        'rechaz',
      );

      // Y mientras espera, lo único que se puede hacer es esperar o cancelar.
      const pending = describeIntentState('pending');
      expect(pending.showCountdown).toBe(true);
      expect(pending.canCancel).toBe(true);
      expect(pending.canConfirm).toBe(false);
    });
  });
});
