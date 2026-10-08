import { describe, expect, it } from 'vitest';
import {
  arDay,
  bucketLabel,
  chartScale,
  groupByWeekday,
  resolveReportRange,
  validGranularity,
  weekdayRangeTooLong,
} from './reportUtils';

const now = new Date('2026-10-08T15:00:00.000Z');

describe('ventanas de informes en hora argentina', () => {
  it('usa la medianoche local y no la fecha UTC para los presets', () => {
    expect(arDay(new Date('2026-10-09T01:00:00.000Z'))).toBe('2026-10-08');
    const result = resolveReportRange({
      preset: '7d',
      fromTime: '00:00',
      toTime: '23:59',
      now,
    });
    expect(result).toMatchObject({
      scope: {
        from: '2026-10-02T00:00:00-03:00',
        to: now.toISOString(),
      },
      suggested: 'day',
    });
  });

  it('envía solo el identificador cuando se consulta una caja', () => {
    const result = resolveReportRange({
      preset: 'caja',
      fromTime: '00:00',
      toTime: '23:59',
      cashSession: {
        id: 'caja-1',
        openedAt: '2026-10-08T09:00:00.000Z',
      },
      now,
    });
    expect(result).toMatchObject({ scope: { cashSessionId: 'caja-1' } });
  });

  it('rechaza un rango invertido y degrada las horas demasiado extensas', () => {
    const inverted = resolveReportRange({
      preset: 'custom',
      range: { from: new Date(2026, 9, 8) },
      fromTime: '18:00',
      toTime: '08:00',
      now,
    });
    expect(inverted).toEqual({
      error: 'La fecha de inicio debe ser anterior a la de fin.',
    });
    expect(
      validGranularity(
        '2026-10-01T00:00:00-03:00',
        '2026-10-08T00:00:00-03:00',
        'hour',
      ),
    ).toEqual({ granularity: 'day', tooFine: false });
  });

  it('formatea el eje desde la clave local del backend', () => {
    expect(bucketLabel('2026-10-08T13', 'hour')).toBe('13h');
    expect(bucketLabel('2026-10-08', 'day')).toBe('08/10');
    expect(bucketLabel('2026-10', 'month')).toBe('Oct');
  });

  it('usa marcas redondas en el eje vertical', () => {
    expect(chartScale(0)).toEqual({ top: 1, ticks: [0, 1] });
    expect(chartScale(155_800)).toEqual({
      top: 200_000,
      ticks: [0, 50_000, 100_000, 150_000, 200_000],
    });
  });
});

describe('agrupación por día de semana', () => {
  const buckets = [
    { key: '2026-10-05', revenue: 100, vehiclesIn: 2, vehiclesOut: 1 },
    { key: '2026-10-06', revenue: 0, vehiclesIn: 0, vehiclesOut: 0 },
    { key: '2026-10-12', revenue: 300, vehiclesIn: 4, vehiclesOut: 3 },
  ];
  it('suma lunes a domingo sin desplazar las fechas por zona horaria', () => {
    const result = groupByWeekday(buckets, 'total');
    expect(result).toHaveLength(7);
    expect(result[0]).toMatchObject({
      key: 'Lunes',
      revenue: 400,
      vehiclesIn: 6,
      days: 2,
    });
    expect(result[1]).toMatchObject({ key: 'Martes', revenue: 0, days: 1 });
  });
  it('incluye días sin movimientos al calcular el promedio', () => {
    const result = groupByWeekday(buckets, 'average');
    expect(result[0]).toMatchObject({ revenue: 200, vehiclesIn: 3, days: 2 });
    expect(result[1]).toMatchObject({ revenue: 0, days: 1 });
  });
  it('mantiene vacío el gráfico sin buckets y limita por fechas argentinas inclusivas', () => {
    expect(groupByWeekday([], 'total')).toEqual([]);
    expect(
      weekdayRangeTooLong(
        '2026-10-05T12:00:00-03:00',
        '2026-10-06T12:00:00-03:00',
      ),
    ).toBe(false);
    expect(
      weekdayRangeTooLong(
        '2024-01-01T12:00:00-03:00',
        '2026-10-01T12:00:00-03:00',
      ),
    ).toBe(true);
  });
});
