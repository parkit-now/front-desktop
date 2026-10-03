import { describe, expect, it } from 'vitest';
import {
  exitCharge,
  formatReservationWindow,
  matchesPlate,
  normalizePlate,
  prepaidOf,
  reservationCode,
  todayRangeIso,
} from './reservationUtils';

// Tarifa $1.500/h y $125 la fracción de 5 minutos, sin topes.
const PRICES = { hour: 1500, fraction: 125, mediaEstadia: 0, stay: 0 };
const ENTERED = '2026-10-06T20:52:00.000Z'; // 17:52 en Buenos Aires
const after = (minutes: number) =>
  new Date(new Date(ENTERED).getTime() + minutes * 60_000).toISOString();

describe('exitCharge (excedente al salir)', () => {
  it('sin reserva cobra la estadía entera, como siempre', () => {
    expect(
      exitCharge({
        enteredAt: ENTERED,
        leftAt: after(228),
        prices: PRICES,
        prepaid: null,
      }),
    ).toEqual({
      stayTotal: 5750,
      prepaid: null,
      due: 5750,
      coveredByReservation: false,
    });
  });

  it('con reserva cobra sólo lo que excede al prepago', () => {
    // 3 h 48 min = $5.750; ya pagó $4.500 → $1.250.
    expect(
      exitCharge({
        enteredAt: ENTERED,
        leftAt: after(228),
        prices: PRICES,
        prepaid: 4500,
      }),
    ).toEqual({
      stayTotal: 5750,
      prepaid: 4500,
      due: 1250,
      coveredByReservation: false,
    });
  });

  it('si sale dentro de lo pagado no se cobra nada y se cierra sin cobro', () => {
    const charge = exitCharge({
      enteredAt: ENTERED,
      leftAt: after(170),
      prices: PRICES,
      prepaid: 4500,
    });
    expect(charge.due).toBe(0);
    expect(charge.coveredByReservation).toBe(true);
  });

  it('nunca es negativo: salir antes no genera vuelto', () => {
    expect(
      exitCharge({
        enteredAt: ENTERED,
        leftAt: after(30),
        prices: PRICES,
        prepaid: 4500,
      }).due,
    ).toBe(0);
  });
});

describe('prepaidOf', () => {
  it('null si el ingreso no tiene reserva', () => {
    expect(prepaidOf({})).toBeNull();
  });

  it('el prepago del snapshot', () => {
    expect(prepaidOf({ reservationId: 'r', prepaidAmountArs: '4500' })).toBe(
      4500,
    );
  });

  it('vinculado pero sin monto conocido: 0 (se cobra la estadía entera)', () => {
    expect(prepaidOf({ reservationId: 'r' })).toBe(0);
  });
});

describe('patente y código', () => {
  it('normaliza como el backend', () => {
    expect(normalizePlate('ab 123-cd')).toBe('AB123CD');
  });

  it('el match vale sólo para la patente tipeada', () => {
    expect(matchesPlate({ vehiclePlate: 'AB123CD' }, 'ab123cd')).toBe(true);
    expect(matchesPlate({ vehiclePlate: 'AB123CD' }, 'AB123C')).toBe(false);
    expect(matchesPlate(null, 'AB123CD')).toBe(false);
  });

  it('código R- con los últimos 6 del id', () => {
    expect(reservationCode('0192aa00-0000-7000-8000-0000004f2k9a')).toBe(
      'R-4F2K9A',
    );
  });
});

describe('fechas en hora de Buenos Aires', () => {
  const now = new Date('2026-10-06T15:00:00.000Z'); // 12:00 AR

  it('franja de hoy con "Hoy" adelante', () => {
    expect(
      formatReservationWindow(
        '2026-10-06T21:00:00.000Z',
        '2026-10-07T00:00:00.000Z',
        now,
      ),
    ).toBe('Hoy 18:00 – 21:00');
  });

  it('franja de otro día sin "Hoy"', () => {
    expect(
      formatReservationWindow(
        '2026-10-07T21:00:00.000Z',
        '2026-10-08T00:00:00.000Z',
        now,
      ),
    ).toBe('18:00 – 21:00');
  });

  it('el día de hoy va de 00:00 a 23:59:59.999 de Buenos Aires', () => {
    expect(todayRangeIso(now)).toEqual({
      from: '2026-10-06T03:00:00.000Z',
      to: '2026-10-07T02:59:59.999Z',
    });
    // 23:30 AR del 6 sigue siendo el 6.
    expect(todayRangeIso(new Date('2026-10-07T02:30:00.000Z')).from).toBe(
      '2026-10-06T03:00:00.000Z',
    );
  });
});
