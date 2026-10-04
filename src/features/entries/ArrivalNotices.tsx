import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useState } from 'react';
import { Clock, X } from 'lucide-react';
import { unlinkEntryReservation } from '../../lib/api/entries';
import { localDb, type LocalEntry } from '../../lib/db/localDb';
import { useNetwork } from '../../lib/network/NetworkContext';
import { useToast } from '../../lib/notifications/ToastProvider';
import { entryToLocal } from '../../lib/sync/SyncService';
import { ConfirmDialog } from '../../lib/ui/ConfirmDialog';
import {
  arrivalNoticeText,
  canUnlinkReservation,
  reservationCode,
  unlinkErrorMessage,
} from './reservationUtils';

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
  canUnlink: boolean;
};

interface Props {
  tenantId: string;
  accessToken: string;
  /** Relee la foto de reservas (la reserva desvinculada vuelve a Confirmada). */
  onReservationsChanged?: () => Promise<void> | void;
}

/**
 * Avisos de la fase 6c en el operativo: un auto que entró vinculado a su
 * reserva ANTES de la ventana normal (dentro del tope del estacionamiento) o
 * TARDE (pasada la tolerancia). No bloquean nada: el ingreso ya está hecho.
 *
 * Sirve igual para el ingreso manual y para el de la cámara (LPR), que llega
 * por el sync: cruza los ingresos abiertos con reserva con la foto local de
 * reservas, donde el backend dice cómo llegó (`arrival`). Sin esa foto (sin
 * conexión, o un backend anterior) no hay aviso.
 *
 * "Desvincular" deja el ingreso como estadía común (se cobra todo al salir) y
 * devuelve la reserva a Confirmada. Sólo con conexión y con el ingreso ya
 * sincronizado y sin operaciones encoladas (ver `canUnlinkReservation`).
 */
export function ArrivalNotices({
  tenantId,
  accessToken,
  onReservationsChanged,
}: Props) {
  const { isOnline } = useNetwork();
  const { showToast } = useToast();
  const [dismissed, setDismissed] = useState<Set<string>>(readDismissed);
  const [confirming, setConfirming] = useState<Notice | null>(null);
  const [pending, setPending] = useState(false);

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
    const pendingOps = await localDb.pendingOps
      .where('entityType')
      .equals('entry')
      .filter((op) => op.tenantId === tenantId)
      .toArray();
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
        canUnlink: canUnlinkReservation({
          isOnline: true,
          entry,
          pendingOpsForEntry: pendingOps.filter(
            (op) => op.entityId === entry.id,
          ).length,
        }),
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

  const unlink = useCallback(
    async (notice: Notice) => {
      setPending(true);
      try {
        const result = await unlinkEntryReservation({
          tenantId,
          entryId: notice.entry.id,
          expectedVersion: notice.entry.version,
          bearer: accessToken,
        });
        await localDb.entries.put(entryToLocal(result));
        showToast({
          message: `Reserva ${reservationCode(notice.reservationId)} desvinculada: ${notice.entry.plate} queda como estadía común y se cobra completa al salir.`,
          kind: 'success',
        });
        setConfirming(null);
        await onReservationsChanged?.();
      } catch (error) {
        showToast({ message: unlinkErrorMessage(error), kind: 'error' });
      } finally {
        setPending(false);
      }
    },
    [tenantId, accessToken, showToast, onReservationsChanged],
  );

  const visible = (notices ?? []).filter(
    (notice) => !dismissed.has(notice.entry.id),
  );
  if (visible.length === 0 && !confirming) return null;

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
              className="ghost-button arrival-notice-unlink"
              onClick={() => setConfirming(notice)}
              disabled={!isOnline || !notice.canUnlink || pending}
              title={
                !isOnline
                  ? 'Sin conexión: desvincular necesita conexión.'
                  : !notice.canUnlink
                    ? 'El ingreso todavía no se sincronizó.'
                    : undefined
              }
            >
              Desvincular
            </button>
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
      <ConfirmDialog
        open={confirming !== null}
        title={
          confirming
            ? `¿Desvincular la reserva de ${confirming.entry.plate}?`
            : ''
        }
        message={
          confirming
            ? `El ingreso queda como estadía común: al salir se cobra la estadía completa, sin descontar lo que pagó por la reserva ${reservationCode(confirming.reservationId)}. La reserva vuelve a Confirmada (o a No se presentó, si ya pasó su tolerancia). No se hace ningún reembolso.`
            : ''
        }
        confirmLabel="Desvincular"
        variant="warning"
        isPending={pending}
        onCancel={() => setConfirming(null)}
        onConfirm={() => (confirming ? unlink(confirming) : undefined)}
      />
    </section>
  );
}
