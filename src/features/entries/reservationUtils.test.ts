import { describe, expect, it } from 'vitest';
import { ApiError } from '../../lib/api/client';
import {
  arrivalNoticeText,
  canUnlinkReservation,
  exitBreakdown,
  exitCharge,
  formatOutsideTime,
  arrivalChipText,
  formatMinutes,
  formatReservationWindow,
  isLinkableMatch,
  matchArrivalText,
  unlinkErrorMessage,
  upcomingReservationText,
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

describe('llegada anticipada o tardía (6c)', () => {
  // 20:30 en Buenos Aires.
  const RES_AT = '2026-10-06T23:30:00.000Z';

  it('formatMinutes', () => {
    expect(formatMinutes(50)).toBe('50 min');
    expect(formatMinutes(60)).toBe('1 h');
    expect(formatMinutes(90)).toBe('1 h 30 min');
    expect(formatMinutes(-3)).toBe('0 min');
  });

  it('aviso de un ingreso vinculado que llegó antes', () => {
    expect(
      arrivalNoticeText({
        arrival: 'early',
        minutesEarly: 50,
        entryAt: RES_AT,
      }),
    ).toBe(
      'Llegó 50 min antes de su reserva de 20:30. El tiempo extra se cobra al salir.',
    );
  });

  it('aviso de un ingreso vinculado que llegó tarde', () => {
    expect(
      arrivalNoticeText({ arrival: 'late', minutesLate: 45, entryAt: RES_AT }),
    ).toBe('Llegó tarde (reserva 20:30).');
  });

  it('a tiempo, o sin dato del backend, no hay aviso', () => {
    expect(arrivalNoticeText({ arrival: 'on_time', entryAt: RES_AT })).toBe(
      null,
    );
    expect(arrivalNoticeText({ entryAt: RES_AT })).toBeNull();
  });

  it('el banner del ingreso habla en presente', () => {
    expect(
      matchArrivalText({ arrival: 'early', minutesEarly: 75, entryAt: RES_AT }),
    ).toBe(
      'Llega 1 h 15 min antes de su reserva de 20:30. El tiempo extra se cobra al salir.',
    );
    expect(matchArrivalText({ arrival: 'late', entryAt: RES_AT })).toBe(
      'Llega tarde (reserva 20:30).',
    );
    expect(matchArrivalText({ arrival: 'on_time', entryAt: RES_AT })).toBe(
      null,
    );
  });

  it('aviso de reserva más tarde: hoy o mañana', () => {
    const now = new Date('2026-10-06T21:00:00.000Z'); // 18:00
    expect(
      upcomingReservationText(
        { entryAt: RES_AT, linkableFrom: '2026-10-06T22:30:00.000Z' },
        now,
      ),
    ).toBe(
      'Esta patente tiene una reserva hoy a las 20:30. Si entra ahora, es una estadía común: la reserva se toma sola desde las 19:30.',
    );
    expect(upcomingReservationText({ entryAt: RES_AT }, now)).toBe(
      'Esta patente tiene una reserva hoy a las 20:30. Si entra ahora, es una estadía común.',
    );
    // 23:40 → reserva a la 01:10 del día siguiente.
    expect(
      upcomingReservationText(
        { entryAt: '2026-10-07T04:10:00.000Z' },
        new Date('2026-10-07T02:40:00.000Z'),
      ),
    ).toBe(
      'Esta patente tiene una reserva mañana a las 01:10. Si entra ahora, es una estadía común.',
    );
  });

  it('isLinkableMatch: un backend viejo sin `linkable` vincula todo lo que devuelve', () => {
    expect(isLinkableMatch({})).toBe(true);
    expect(isLinkableMatch({ linkable: true })).toBe(true);
    expect(isLinkableMatch({ linkable: false })).toBe(false);
  });

  it('arrivalChipText (salida)', () => {
    expect(arrivalChipText({ arrival: 'early', minutesEarly: 50 })).toBe(
      'Llegó 50 min antes',
    );
    expect(arrivalChipText({ arrival: 'late', minutesEarly: 0 })).toBe(
      'Llegó tarde',
    );
    expect(arrivalChipText({ arrival: 'on_time' })).toBeNull();
    expect(arrivalChipText({})).toBeNull();
  });

  it('desglose de la salida: reservado, extra antes y después', () => {
    const breakdown = exitBreakdown({
      enteredAt: '2026-10-06T22:40:00.000Z', // 19:40, 50' antes
      leftAt: '2026-10-07T02:45:00.000Z', // 23:45, 15' después
      reservationEntryAt: RES_AT,
      reservationExitAt: '2026-10-07T02:30:00.000Z', // 23:30
    });
    expect(breakdown).toEqual({
      reservedMinutes: 180,
      extraBeforeMinutes: 50,
      extraAfterMinutes: 15,
      extraMinutes: 65,
    });
    expect(formatOutsideTime(breakdown)).toBe(
      '50 min antes del horario + 15 min después del horario',
    );
  });

  it('dentro de la franja no hay tiempo extra', () => {
    const breakdown = exitBreakdown({
      enteredAt: '2026-10-06T23:35:00.000Z',
      leftAt: '2026-10-07T01:00:00.000Z',
      reservationEntryAt: RES_AT,
      reservationExitAt: '2026-10-07T02:30:00.000Z',
    });
    expect(breakdown.extraMinutes).toBe(0);
    expect(formatOutsideTime(breakdown)).toBeNull();
  });

  it('el excedente con llegada anticipada sale de la estadía real menos el prepago', () => {
    // Reserva de 3 h a $1.500/h + $125 la fracción = $4.500. Entró 50' antes
    // y salió a la hora: 3 h 50 min = $5.750 → cobra $1.250.
    expect(
      exitCharge({
        enteredAt: '2026-10-06T22:40:00.000Z',
        leftAt: '2026-10-07T02:30:00.000Z',
        prices: PRICES,
        prepaid: 4500,
      }),
    ).toMatchObject({ stayTotal: 5750, due: 1250 });
  });

  describe('canUnlinkReservation', () => {
    const entry = { reservationId: 'r-1', syncSeq: 12 };
    it('con conexión, adentro, sincronizado y sin ops encoladas: sí', () => {
      expect(
        canUnlinkReservation({ isOnline: true, entry, pendingOpsForEntry: 0 }),
      ).toBe(true);
    });
    it.each([
      ['sin conexión', { isOnline: false, entry, pendingOpsForEntry: 0 }],
      [
        'ya salió',
        {
          isOnline: true,
          entry: { ...entry, leftAt: '2026-10-07T02:30:00.000Z' },
          pendingOpsForEntry: 0,
        },
      ],
      [
        'sin reserva',
        {
          isOnline: true,
          entry: { syncSeq: 12 },
          pendingOpsForEntry: 0,
        },
      ],
      [
        'todavía no sincronizado',
        {
          isOnline: true,
          entry: { ...entry, syncSeq: 0 },
          pendingOpsForEntry: 0,
        },
      ],
      ['con ops encoladas', { isOnline: true, entry, pendingOpsForEntry: 1 }],
    ])('%s: no', (_label, input) => {
      expect(canUnlinkReservation(input)).toBe(false);
    });
  });
});

describe('unlinkErrorMessage', () => {
  const problem = (code: string) => ({ code }) as never;
  it('409 por versión: explica que otra caja lo cambió', () => {
    expect(
      unlinkErrorMessage(new ApiError(409, 'Conflict', problem('CONFLICT'))),
    ).toBe(
      'Este ingreso cambió en otra caja. Esperá a que se sincronice y volvé a intentar.',
    );
  });
  it('el auto ya salió', () => {
    expect(
      unlinkErrorMessage(
        new ApiError(
          409,
          'Conflict',
          problem('ENTRY_RESERVATION_UNLINK_CLOSED'),
        ),
      ),
    ).toBe('El auto ya salió: la reserva no se puede desvincular.');
  });
});
