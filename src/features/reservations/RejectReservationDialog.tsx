import { useEffect, useId, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { formatArs } from '../../lib/format/argentina';
import type { LocalReservation } from '../../lib/db/localDb';
import { formatSlot, OFFLINE_ACTIONS_MESSAGE } from './reservationBoard';

export const REASON_MAX_LENGTH = 500;

interface Props {
  reservation: LocalReservation;
  /** Lo que se le devuelve al conductor: rechazar siempre devuelve el total. */
  refundArs: number;
  saving: boolean;
  isOnline: boolean;
  /** La reserva ya no espera respuesta (la resolvieron en otro lado). */
  stale: boolean;
  /** Error del último intento, ya traducido. */
  error: string | null;
  onConfirm: (reason: string) => void;
  onClose: () => void;
}

/**
 * Pide el motivo (obligatorio, lo ve el conductor) antes de rechazar y avisa
 * cuánto se le devuelve. Mismo texto que el diálogo del dueño en la web.
 */
export function RejectReservationDialog({
  reservation,
  refundArs,
  saving,
  isOnline,
  stale,
  error,
  onConfirm,
  onClose,
}: Props) {
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const ids = useId();
  const trimmed = reason.trim();
  const blocked = !isOnline || stale;
  // Bloqueado no se puede escribir: no tiene sentido pedir el motivo.
  const missing = touched && trimmed.length === 0 && !blocked;

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [saving, onClose]);

  function submit() {
    setTouched(true);
    if (trimmed.length === 0) {
      textareaRef.current?.focus();
      return;
    }
    onConfirm(trimmed);
  }

  return (
    <div
      className="rate-dialog-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !saving) onClose();
      }}
    >
      <section
        className="rate-dialog reject-reservation-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${ids}-title`}
        aria-describedby={stale ? undefined : `${ids}-refund`}
      >
        <header className="rate-dialog-header">
          <div>
            <p className="rate-dialog-kicker">Rechazar reserva</p>
            <h3 id={`${ids}-title`}>
              {reservation.vehiclePlate} · {reservation.code}
            </h3>
            <p className="muted">
              {formatSlot(reservation.entryAt, reservation.exitAt)}
              {reservation.driverName ? ` · ${reservation.driverName}` : ''}
            </p>
          </div>
          <button
            type="button"
            className="rate-dialog-close"
            onClick={onClose}
            disabled={saving}
            aria-label="Volver sin rechazar"
          >
            <X size={18} />
          </button>
        </header>

        <form
          className="reject-reservation-form"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="form-field">
            <label className="form-label" htmlFor={`${ids}-reason`}>
              Motivo (lo ve el conductor)
              <span aria-hidden="true" className="required-mark">
                {' '}
                *
              </span>
            </label>
            <textarea
              ref={textareaRef}
              id={`${ids}-reason`}
              rows={3}
              maxLength={REASON_MAX_LENGTH}
              required
              aria-required="true"
              aria-invalid={missing}
              aria-describedby={missing ? `${ids}-missing` : undefined}
              value={reason}
              placeholder="Ej.: Playa completa por un evento"
              disabled={saving || blocked}
              onChange={(e) => setReason(e.target.value)}
              onBlur={() => setTouched(true)}
            />
            {missing ? (
              <p id={`${ids}-missing`} className="field-error">
                Escribí el motivo para rechazar.
              </p>
            ) : null}
          </div>

          {stale ? null : (
            <p id={`${ids}-refund`} className="reject-reservation-refund">
              Le devolvemos <strong>{formatArs(refundArs)}</strong> al conductor
              por Mercado Pago. El reembolso siempre es total.
            </p>
          )}

          {stale ? (
            <p role="status" className="field-hint field-warning">
              Esta reserva ya no está esperando respuesta: la resolvieron desde
              la web o desde otra caja.
            </p>
          ) : !isOnline ? (
            <p role="status" className="field-hint field-warning">
              {OFFLINE_ACTIONS_MESSAGE}
            </p>
          ) : null}

          {error ? (
            <p role="alert" className="field-error">
              {error}
            </p>
          ) : null}

          <div className="rate-dialog-actions">
            <button
              type="button"
              className="ghost-button"
              onClick={onClose}
              disabled={saving}
            >
              {stale ? 'Cerrar' : 'Volver'}
            </button>
            <button
              type="submit"
              className="primary-button compact danger-button"
              disabled={saving || blocked}
            >
              {saving ? 'Rechazando…' : 'Rechazar y reembolsar'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
