import { describe, expect, it } from 'vitest';
import { formatStayDuration, formatTableDateTime } from './StayDateCell';

describe('formatTableDateTime', () => {
  it('separa fecha y hora en el horario argentino', () => {
    expect(formatTableDateTime('2026-10-08T12:05:00.000Z')).toEqual({
      date: '08/10/2026',
      time: '09:05',
    });
    expect(formatTableDateTime('2026-10-08T02:59:00.000Z')).toEqual({
      date: '07/10/2026',
      time: '23:59',
    });
  });

  it('no muestra valores inventados para un timestamp invalido', () => {
    expect(formatTableDateTime('bad')).toBeNull();
  });
});

describe('formatStayDuration', () => {
  const entry = '2026-10-08T10:00:00.000Z';

  it('muestra una estancia cerrada con horas y minutos', () => {
    expect(formatStayDuration(entry, '2026-10-08T11:11:00.000Z')).toBe(
      '1 h 11 min',
    );
    expect(formatStayDuration(entry, '2026-10-08T10:01:00.000Z')).toBe('1 min');
  });

  it('calcula en curso contra el reloj actual y maneja dias completos', () => {
    expect(
      formatStayDuration(entry, null, Date.parse('2026-10-08T15:44:00.000Z')),
    ).toBe('5 h 44 min');
    expect(
      formatStayDuration(entry, null, Date.parse('2026-10-09T12:00:00.000Z')),
    ).toBe('1 d 2 h');
  });

  it('no inventa tiempos para fechas invalidas o invertidas', () => {
    expect(formatStayDuration('bad', null)).toBe('—');
    expect(formatStayDuration(entry, '2026-10-08T09:00:00.000Z')).toBe('—');
    expect(formatStayDuration(entry, '2026-10-08T10:00:01.000Z')).toBe(
      '< 1 min',
    );
  });
});
