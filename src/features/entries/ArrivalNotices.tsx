import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useState } from 'react';
import { Clock, X } from 'lucide-react';
import { localDb, type LocalEntry } from '../../lib/db/localDb';
import { arrivalNoticeText, reservationCode } from './reservationUtils';

/**
 * Cuánto tiempo después del ingreso sigue a la vista el aviso. Es para el
 * momento en que el auto llega; después es ruido (el chip de la sección
 * Reservas lo sigue diciendo).
 */
export const ARRIVAL_NOTICE_TTL_MS = 2 * 60 * 60_000;

const DISMISSED_KEY = 'parkit.arrivalNotices.dismissed';

function readDismissed(): Set<string> {
  try {
    const raw = sessionStorage.getItem(DISMISSED_KEY);
    const ids: unknown = raw ? JSON.parse(raw) : [];
    return new Set(
      Array.isArray(ids)
        ? ids.filter((id): id is string => typeof id === 'string')
        : [],
    );
  } catch {
    return new Set();
  }
}

function writeDismissed(ids: Set<string>): void {
  try {
    sessionStorage.setItem(DISMISSED_KEY, JSON.stringify([...ids]));
  } catch {
    // Sin storage el aviso vuelve a aparecer al recargar: no es grave.
  }
}

type Notice = {
  entry: LocalEntry;
  reservationId: string;
  text: string;
  arrival: 'early' | 'late';
};

interface Props {
  tenantId: string;
}

/**
 * Avisos de la fase 6c en el operativo: un auto que entró vinculado a su
 * reserva ANTES de la ventana normal (dentro del tope del estacionamiento) o
 * TARDE (pasada la tolerancia). No bloquean nada: el ingreso ya está hecho.
 *
 * Sirve igual para el ingreso manual y para el de la cámara (LPR), que llega
 * por el sync: cruza los ingresos abiertos con reserva con la foto local de
 * reservas, donde el backend dice cómo llegó (`arrival`). Sin esa foto (sin
 * conexión, o un backend anterior) no hay aviso. Son sólo informativos.
 */
export function ArrivalNotices({ tenantId }: Props) {
  const [dismissed, setDismissed] = useState<Set<string>>(readDismissed);

  const notices = useLiveQuery(async (): Promise<Notice[]> => {
    const now = Date.now();
    const open = await localDb.entries
      .where('tenantId')
      .equals(tenantId)
      .filter(
        (entry) =>
          !entry.leftAt &&
          Boolean(entry.reservationId) &&
          now - Date.parse(entry.enteredAt) <= ARRIVAL_NOTICE_TTL_MS,
      )
      .toArray();
    if (open.length === 0) return [];
    const reservations = await localDb.reservations.bulkGet(
      open.map((entry) => entry.reservationId!),
    );
    const result: Notice[] = [];
    open.forEach((entry, index) => {
      const reservation = reservations[index];
      if (!reservation) return;
      if (reservation.arrival !== 'early' && reservation.arrival !== 'late') {
        return;
      }
      const text = arrivalNoticeText(reservation);
      if (!text) return;
      result.push({
        entry,
        reservationId: reservation.id,
        text,
        arrival: reservation.arrival,
      });
    });
    return result.sort((a, b) =>
      b.entry.enteredAt.localeCompare(a.entry.enteredAt),
    );
  }, [tenantId]);

  const dismiss = useCallback((entryId: string) => {
    setDismissed((current) => {
      const next = new Set(current);
      next.add(entryId);
      writeDismissed(next);
      return next;
    });
  }, []);

  const visible = (notices ?? []).filter(
    (notice) => !dismissed.has(notice.entry.id),
  );
  if (visible.length === 0) return null;

  return (
    <section className="arrival-notices" aria-label="Avisos de reservas">
      {visible.map((notice) => (
        <div
          key={notice.entry.id}
          className={`arrival-notice arrival-notice--${notice.arrival}`}
          role="status"
          aria-live="polite"
        >
          <Clock size={16} aria-hidden="true" className="arrival-notice-icon" />
          <div className="arrival-notice-body">
            <strong>
              {notice.entry.plate} · {reservationCode(notice.reservationId)}
            </strong>
            <span>{notice.text}</span>
          </div>
          <div className="arrival-notice-actions">
            <button
              type="button"
              className="arrival-notice-close"
              onClick={() => dismiss(notice.entry.id)}
              aria-label={`Ocultar el aviso de ${notice.entry.plate}`}
            >
              <X size={15} />
            </button>
          </div>
        </div>
      ))}
    </section>
  );
}
