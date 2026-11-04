import type { DataTableSearchMode } from './types';
import { normalizeText } from './utils';

type VehicleSearchFields<TData> = {
  ticket?: (row: TData) => string | number | null | undefined;
  plate?: (row: TData) => string | readonly string[] | null | undefined;
  fields?: readonly DataTableSearchMode<TData>[];
};

function normalizedTicket(value: string | number | null | undefined) {
  const digits = /^#?(\d+)$/.exec(String(value ?? '').trim())?.[1];
  return digits?.replace(/^0+(?=\d)/, '');
}

export function createVehicleSearchModes<TData>({
  ticket,
  plate,
  fields = [],
}: VehicleSearchFields<TData>): DataTableSearchMode<TData>[] {
  const modes: DataTableSearchMode<TData>[] = [{ id: 'all', label: 'Todos' }];
  if (ticket) {
    modes.push({
      id: 'ticket',
      label: 'Ticket',
      placeholder: 'Buscar por ticket…',
      matches: (row, query) => {
        const wanted = normalizedTicket(query);
        return wanted !== undefined && normalizedTicket(ticket(row)) === wanted;
      },
    });
  }
  if (plate) {
    modes.push({
      id: 'plate',
      label: 'Patente',
      placeholder: 'Buscar por patente…',
      matches: (row, query) => {
        const value = plate(row);
        const plates = Array.isArray(value) ? value : [value];
        return plates.some((item) =>
          normalizeText(item).includes(normalizeText(query)),
        );
      },
    });
  }
  return [...modes, ...fields];
}
