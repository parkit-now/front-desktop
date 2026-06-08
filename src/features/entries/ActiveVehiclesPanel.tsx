import { useLiveQuery } from 'dexie-react-hooks';
import { LogOut } from 'lucide-react';
import { useState } from 'react';
import { localDb, type LocalEntry } from '../../lib/db/localDb';
import { formatArgentinaDateTime, formatArs } from '../../lib/format/argentina';
import { formatDuration } from './entryUtils';
import { ExitModal } from './ExitModal';

interface Props {
  tenantId: string;
  accessToken: string;
}

export function ActiveVehiclesPanel({ tenantId, accessToken }: Props) {
  const [exitEntry, setExitEntry] = useState<LocalEntry | null>(null);

  const activeEntries = useLiveQuery(
    () =>
      localDb.entries
        .where('tenantId')
        .equals(tenantId)
        .filter((e) => !e.leftAt)
        .toArray()
        .then((arr) =>
          arr.sort(
            (a, b) =>
              new Date(b.enteredAt).getTime() - new Date(a.enteredAt).getTime(),
          ),
        ),
    [tenantId],
  );

  const loading = activeEntries === undefined;

  if (loading) {
    return <p className="muted">Cargando vehículos activos...</p>;
  }

  if (activeEntries.length === 0) {
    return (
      <div className="active-vehicles-empty">
        <p className="muted">No hay vehículos estacionados en este momento.</p>
      </div>
    );
  }

  return (
    <>
      <div className="active-vehicles-grid">
        {activeEntries.map((entry) => (
          <div key={entry.id} className="vehicle-card">
            <div className="vehicle-card-top">
              <span className="vehicle-plate">{entry.plate}</span>
              {entry.color ? (
                <span className="vehicle-color muted">{entry.color}</span>
              ) : null}
            </div>

            <div className="vehicle-card-meta">
              <span className="vehicle-duration">
                {formatDuration(entry.enteredAt)}
              </span>
              <span className="muted">
                {formatArgentinaDateTime(entry.enteredAt)}
              </span>
            </div>

            {entry.rateSnapshotName ? (
              <div className="vehicle-card-rate">
                <span className="muted mini">{entry.rateSnapshotName}</span>
                {entry.rateSnapshotHourPriceArs ? (
                  <span className="muted mini">
                    {formatArs(parseFloat(entry.rateSnapshotHourPriceArs))}/h
                  </span>
                ) : null}
              </div>
            ) : (
              <div className="vehicle-card-rate">
                <span className="muted mini">Sin tarifa</span>
              </div>
            )}

            <button
              type="button"
              className="primary-button compact vehicle-exit-btn"
              onClick={() => {
                setExitEntry(entry);
              }}
            >
              <LogOut size={15} />
              Registrar egreso
            </button>
          </div>
        ))}
      </div>

      {exitEntry ? (
        <ExitModal
          entry={exitEntry}
          tenantId={tenantId}
          accessToken={accessToken}
          onClose={() => {
            setExitEntry(null);
          }}
        />
      ) : null}
    </>
  );
}
