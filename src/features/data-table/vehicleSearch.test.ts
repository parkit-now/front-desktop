import { describe, expect, it } from 'vitest';
import { createVehicleSearchModes } from './vehicleSearch';

type Row = {
  ticket?: string | number | null;
  plate?: string | string[] | null;
};
const modes = createVehicleSearchModes<Row>({
  ticket: (row) => row.ticket,
  plate: (row) => row.plate,
});
const ticket = modes.find((mode) => mode.id === 'ticket')!.matches!;
const plate = modes.find((mode) => mode.id === 'plate')!.matches!;

describe('modos compartidos de búsqueda de vehículos', () => {
  it('ofrece Todos primero y solo los campos configurados', () => {
    expect(modes.map((mode) => mode.id)).toEqual(['all', 'ticket', 'plate']);
    expect(modes[0].matches).toBeUndefined();
    expect(
      createVehicleSearchModes<Row>({ plate: (row) => row.plate }).map(
        (mode) => mode.id,
      ),
    ).toEqual(['all', 'plate']);
    expect(
      createVehicleSearchModes<Row>({ ticket: (row) => row.ticket }).map(
        (mode) => mode.id,
      ),
    ).toEqual(['all', 'ticket']);
  });
  it.each(['66', '#66', ' 0066 ', '#00066'])(
    'busca %s exactamente en tickets numéricos o de auditoría',
    (query) => {
      expect(ticket({ ticket: 66 }, query)).toBe(true);
      expect(ticket({ ticket: '66' }, query)).toBe(true);
      expect(ticket({ ticket: '#66' }, query)).toBe(true);
      expect(ticket({ ticket: 166, plate: 'AA066AA' }, query)).toBe(false);
      expect(ticket({ ticket: null }, query)).toBe(false);
      expect(ticket({ ticket: '—' }, query)).toBe(false);
    },
  );
  it.each(['', '#', '66x', '66 6', '6.6', '-66'])(
    'no interpreta una consulta inválida: %s',
    (query) => {
      expect(ticket({ ticket: 66 }, query)).toBe(false);
    },
  );
  it('distingue cero de un ticket ausente', () => {
    expect(ticket({ ticket: 0 }, '000')).toBe(true);
    expect(ticket({}, '0')).toBe(false);
  });
  it('busca fragmentos de patente sin distinguir mayúsculas, también en clientes con varias patentes', () => {
    expect(plate({ plate: 'AB066CD' }, ' ab066 ')).toBe(true);
    expect(plate({ plate: ['XYZ999', 'AB066CD'] }, 'ab066')).toBe(true);
    expect(plate({ plate: 'XYZ999' }, 'ab066')).toBe(false);
    expect(plate({ plate: null }, '66')).toBe(false);
    expect(plate({}, '66')).toBe(false);
  });
});
