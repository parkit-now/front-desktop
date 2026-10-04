import { useState, type ReactNode } from 'react';
import {
  acceptReservation,
  rejectReservation,
} from '../../lib/api/reservations';
import type { LocalReservation } from '../../lib/db/localDb';
import { formatArs } from '../../lib/format/argentina';
import { useNetwork } from '../../lib/network/NetworkContext';
import { useToast } from '../../lib/notifications/ToastProvider';
import { applyReservationResult } from '../../lib/sync/reservationsSnapshot';
import { RejectReservationDialog } from './RejectReservationDialog';
import {
  BUCKET_LABELS,
  bucketOf,
  classifyActionError,
  OFFLINE_ACTIONS_MESSAGE,
  type ReservationAction,
} from './reservationBoard';
import type { ReservationsFeed } from './useReservationsFeed';

export interface ReservationActions {
  /** La fila que está aceptando o rechazando, o `null`. */
  busy: { id: string; action: ReservationAction } | null;
  accept: (r: LocalReservation) => Promise<void>;
  /** Abre el diálogo del motivo para rechazar. */
  openReject: (r: LocalReservation) => void;
  /** El diálogo de rechazo (o `null`): el que usa el hook lo dibuja. */
  rejectDialog: ReactNode;
}

/**
 * Aceptar y rechazar reservas desde la caja (fase 6b), compartido entre la
 * sección Reservas y el modal "Reservas de hoy" del operativo (6c). Mismas
 * reglas en los dos: sin conexión no se hace nada (no se encola), las
 * carreras (`classifyActionError` → `stale`) avisan y releen, y la respuesta
 * del servidor pisa la fila local para que la lista cambie al toque.
 */
export function useReservationActions(input: {
  tenantId: string;
  accessToken: string;
  feed: Pick<ReservationsFeed, 'refresh'>;
  /** La foto local actual: para saber si la del diálogo se resolvió en otro lado. */
  rows: readonly LocalReservation[] | undefined;
}): ReservationActions {
  const { tenantId, accessToken, feed, rows } = input;
  const { isOnline } = useNetwork();
  const { showToast } = useToast();
  const [busy, setBusy] = useState<ReservationActions['busy']>(null);
  const [rejecting, setRejecting] = useState<LocalReservation | null>(null);
  const [rejectError, setRejectError] = useState<string | null>(null);

  // Si la reserva del diálogo se resolvió en otro lado (el dueño desde la web,
  // otra caja, el barrido), el diálogo lo dice en vez de dejar rechazar.
  const rejectingLive = rejecting
    ? (rows?.find((r) => r.id === rejecting.id) ?? null)
    : null;
  const rejectingStale =
    rejecting !== null && rejectingLive?.status !== 'pending_approval';

  async function handleStale(message: string) {
    showToast({ message, kind: 'info' });
    await feed.refresh();
  }

  async function accept(r: LocalReservation) {
    if (!isOnline) {
      showToast({ message: OFFLINE_ACTIONS_MESSAGE, kind: 'info' });
      return;
    }
    setBusy({ id: r.id, action: 'accept' });
    try {
      const updated = await acceptReservation({
        tenantId,
        bearer: accessToken,
        reservationId: r.id,
      });
      await applyReservationResult(updated, tenantId);
      const bucket = bucketOf(updated, new Date());
      showToast({
        message: `Aceptaste la reserva de ${r.vehiclePlate}.${
          bucket && bucket !== 'pending'
            ? ` Pasó a ${BUCKET_LABELS[bucket]}.`
            : ''
        }`,
        kind: 'success',
      });
      void feed.refresh();
    } catch (error) {
      const { message, stale } = classifyActionError(error);
      if (stale) await handleStale(message);
      else showToast({ message, kind: 'error' });
    } finally {
      setBusy(null);
    }
  }

  async function reject(reason: string) {
    if (!rejecting) return;
    const r = rejecting;
    setBusy({ id: r.id, action: 'reject' });
    setRejectError(null);
    try {
      const updated = await rejectReservation({
        tenantId,
        bearer: accessToken,
        reservationId: r.id,
        reason,
      });
      await applyReservationResult(updated, tenantId);
      setRejecting(null);
      showToast({
        message: `Rechazaste la reserva de ${r.vehiclePlate}. Le devolvemos ${formatArs(r.totalArs)} al conductor.`,
        kind: 'success',
      });
      void feed.refresh();
    } catch (error) {
      const { message, stale } = classifyActionError(error);
      if (stale) {
        setRejecting(null);
        await handleStale(message);
      } else {
        setRejectError(message);
      }
    } finally {
      setBusy(null);
    }
  }

  return {
    busy,
    accept,
    openReject: (r) => {
      setRejectError(null);
      setRejecting(r);
    },
    rejectDialog: rejecting ? (
      <RejectReservationDialog
        reservation={rejecting}
        refundArs={rejecting.totalArs}
        saving={busy?.id === rejecting.id && busy.action === 'reject'}
        isOnline={isOnline}
        stale={rejectingStale}
        error={rejectError}
        onConfirm={(reason) => void reject(reason)}
        onClose={() => setRejecting(null)}
      />
    ) : null,
  };
}
