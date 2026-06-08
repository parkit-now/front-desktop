import { useLiveQuery } from 'dexie-react-hooks';
import { localDb } from '../../lib/db/localDb';
import { formatArgentinaDateTime, formatArs } from '../../lib/format/argentina';

interface Props {
  tenantId: string;
}

export function EntryHistoryPanel({ tenantId }: Props) {
  const closedEntries = useLiveQuery(
    () =>
      localDb.entries
        .where('tenantId')
        .equals(tenantId)
        .filter((e) => Boolean(e.leftAt))
        .toArray()
        .then((arr) =>
          arr.sort(
            (a, b) =>
              new Date(b.leftAt!).getTime() - new Date(a.leftAt!).getTime(),
          ),
        ),
    [tenantId],
  );

  if (closedEntries === undefined) {
    return <p className="muted">Cargando historial...</p>;
  }

  if (closedEntries.length === 0) {
    return (
      <div className="active-vehicles-empty">
        <p className="muted">No hay movimientos registrados todavía.</p>
      </div>
    );
  }

  return (
    <div className="history-table-wrap">
      <table className="history-table">
        <thead>
          <tr>
            <th>Patente</th>
            <th>Ingreso</th>
            <th>Egreso</th>
            <th>Tarifa</th>
            <th>Cobrado</th>
          </tr>
        </thead>
        <tbody>
          {closedEntries.map((entry) => (
            <tr key={entry.id}>
              <td>
                <strong>{entry.plate}</strong>
              </td>
              <td className="muted">
                {formatArgentinaDateTime(entry.enteredAt)}
              </td>
              <td className="muted">
                {entry.leftAt ? formatArgentinaDateTime(entry.leftAt) : '—'}
              </td>
              <td className="muted">{entry.rateSnapshotName ?? '—'}</td>
              <td>{entry.amountPaid ? formatArs(entry.amountPaid) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
