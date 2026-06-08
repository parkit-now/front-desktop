import { useState } from 'react';
import { X } from 'lucide-react';
import { closeEntry } from '../../lib/api/entries';
import { translateApiError } from '../../lib/api/translate';
import { localDb, type LocalEntry } from '../../lib/db/localDb';
import { useNetwork } from '../../lib/network/NetworkContext';
import { useToast } from '../../lib/notifications/ToastProvider';
import { formatArs, formatArgentinaDateTime } from '../../lib/format/argentina';
import { calcSuggestedAmount, formatDuration } from './entryUtils';

interface Props {
  entry: LocalEntry;
  tenantId: string;
  accessToken: string;
  onClose: () => void;
}

export function ExitModal({ entry, tenantId, accessToken, onClose }: Props) {
  const { showToast } = useToast();
  const { isOnline } = useNetwork();

  const now = new Date().toISOString();
  const hourPrice = entry.rateSnapshotHourPriceArs
    ? parseFloat(entry.rateSnapshotHourPriceArs)
    : 0;
  const stayPrice = entry.rateSnapshotStayPriceArs
    ? parseFloat(entry.rateSnapshotStayPriceArs)
    : 0;
  const fractionPrice = entry.rateSnapshotFractionPriceArs
    ? parseFloat(entry.rateSnapshotFractionPriceArs)
    : 0;

  const suggested = calcSuggestedAmount(
    entry.enteredAt,
    now,
    hourPrice,
    stayPrice,
    fractionPrice,
  );

  const [amount, setAmount] = useState(
    suggested > 0 ? suggested.toFixed(2) : '',
  );
  const [saving, setSaving] = useState(false);

  async function handleConfirm(): Promise<void> {
    setSaving(true);
    const leftAt = new Date().toISOString();
    const amountPaid = amount.trim()
      ? parseFloat(amount.replace(',', '.'))
      : undefined;

    try {
      if (isOnline) {
        const result = await closeEntry({
          tenantId,
          entryId: entry.id,
          expectedVersion: entry.version,
          bearer: accessToken,
          body: { leftAt, amountPaid },
        });
        await localDb.entries.update(entry.id, {
          leftAt: result.leftAt ?? undefined,
          amountPaid:
            result.amountPaid !== null ? String(result.amountPaid) : undefined,
          version: result.version,
          syncSeq: result.syncSeq,
          updatedAt: result.updatedAt,
        });
      } else {
        await localDb.transaction(
          'rw',
          localDb.entries,
          localDb.pendingOps,
          async () => {
            await localDb.entries.update(entry.id, {
              leftAt,
              amountPaid:
                amountPaid !== undefined ? String(amountPaid) : undefined,
              version: entry.version + 1,
              updatedAt: leftAt,
            });
            await localDb.pendingOps.add({
              entityType: 'entry',
              operation: 'update',
              tenantId,
              entityId: entry.id,
              payload: {
                expectedVersion: entry.version,
                body: { leftAt, amountPaid },
              },
              status: 'pending',
              createdAt: Date.now(),
              retryCount: 0,
            });
          },
        );
      }

      showToast({
        message: isOnline
          ? `Egreso registrado: ${entry.plate}`
          : `Egreso guardado localmente: ${entry.plate}`,
        kind: 'success',
      });
      onClose();
    } catch (error) {
      showToast({ message: translateApiError(error), kind: 'error' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="rate-dialog-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        className="rate-dialog exit-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="exit-modal-title"
      >
        <header className="rate-dialog-header">
          <div>
            <p className="rate-dialog-kicker">Egreso</p>
            <h3 id="exit-modal-title">{entry.plate}</h3>
            {entry.color ? <p className="muted">{entry.color}</p> : null}
          </div>
          <button
            type="button"
            className="rate-dialog-close"
            onClick={onClose}
            disabled={saving}
            aria-label="Cerrar"
          >
            <X size={18} />
          </button>
        </header>

        <div className="exit-modal-info">
          <div className="exit-info-row">
            <span className="muted">Ingresó</span>
            <span>{formatArgentinaDateTime(entry.enteredAt)}</span>
          </div>
          <div className="exit-info-row">
            <span className="muted">Tiempo</span>
            <span className="exit-duration">
              {formatDuration(entry.enteredAt)}
            </span>
          </div>
          {entry.rateSnapshotName ? (
            <div className="exit-info-row">
              <span className="muted">Tarifa</span>
              <span>{entry.rateSnapshotName}</span>
            </div>
          ) : null}
        </div>

        <div className="form-field">
          <label className="form-label">Monto cobrado (ARS)</label>
          <input
            type="text"
            inputMode="decimal"
            placeholder="0.00"
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value);
            }}
            autoFocus
          />
          {suggested > 0 ? (
            <p className="form-helper">Sugerido: {formatArs(suggested)}</p>
          ) : null}
        </div>

        <div className="rate-dialog-actions">
          <button
            type="button"
            className="ghost-button"
            onClick={onClose}
            disabled={saving}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="primary-button compact"
            onClick={() => {
              void handleConfirm();
            }}
            disabled={saving}
          >
            {saving ? 'Registrando...' : 'Registrar egreso'}
          </button>
        </div>
      </section>
    </div>
  );
}
