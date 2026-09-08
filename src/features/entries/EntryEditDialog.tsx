import { useEffect, useMemo, useState } from 'react';
import { Plus, Save, Trash2, X } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  correctEntry,
  type CorrectEntryDto,
  type CorrectEntryPaymentLineDto,
} from '../../lib/api/entries';
import { translateApiError } from '../../lib/api/translate';
import {
  localDb,
  type LocalCashSession,
  type LocalEntry,
  type LocalPaymentMethod,
  type LocalPaymentTransaction,
  type LocalRate,
} from '../../lib/db/localDb';
import { formatArs } from '../../lib/format/argentina';
import { useNetwork } from '../../lib/network/NetworkContext';
import { useToast } from '../../lib/notifications/ToastProvider';
import { calcSuggestedAmount, generateUuidV7 } from './entryUtils';

type ActorRole = 'admin' | 'owner' | 'operator' | null;

type EditableEntry = LocalEntry & {
  paymentLines: LocalPaymentTransaction[];
};

type PaymentFormLine = {
  id: string;
  paymentMethodId?: string;
  paymentMethodName: string;
  amount: string;
};

interface Props {
  entry: EditableEntry;
  tenantId: string;
  accessToken: string;
  actorRole: ActorRole;
  cashSession?: LocalCashSession;
  onClose: () => void;
}

function isoToInputValue(value: string | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function inputValueToIso(value: string): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function moneyInput(value: unknown): string {
  if (value === undefined || value === null || value === '') return '';
  const normalized =
    typeof value === 'number'
      ? String(value)
      : typeof value === 'string'
        ? value.replace(',', '.')
        : '';
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed.toFixed(2) : '';
}

function parseMoney(value: string): number {
  const parsed = Number(value.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : 0;
}

function paymentIdentity(lines: PaymentFormLine[]): string {
  return JSON.stringify(
    lines
      .filter((line) => parseMoney(line.amount) > 0)
      .map((line) => ({
        paymentMethodId: line.paymentMethodId ?? null,
        paymentMethodName: line.paymentMethodName,
        amount: Math.round(parseMoney(line.amount) * 100) / 100,
      }))
      .sort((a, b) =>
        `${a.paymentMethodId ?? ''}:${a.paymentMethodName}`.localeCompare(
          `${b.paymentMethodId ?? ''}:${b.paymentMethodName}`,
          'es',
        ),
      ),
  );
}

function toPaymentLines(
  entry: EditableEntry,
  paymentMethods: LocalPaymentMethod[],
): PaymentFormLine[] {
  if (entry.paymentLines.length > 0) {
    return entry.paymentLines.map((line) => ({
      id: line.id,
      paymentMethodId: line.paymentMethodId,
      paymentMethodName: line.paymentMethodName,
      amount: moneyInput(line.amount),
    }));
  }

  if (entry.amountPaid) {
    const fallbackMethod =
      paymentMethods.find((pm) => pm.isDefault) ?? paymentMethods[0];
    return [
      {
        id: generateUuidV7(),
        paymentMethodId: fallbackMethod?.id,
        paymentMethodName: fallbackMethod?.name ?? 'Sin medio',
        amount: moneyInput(entry.amountPaid),
      },
    ];
  }

  return [];
}

function entryToPatch(
  result: LocalEntry,
  body: CorrectEntryDto,
): Partial<LocalEntry> {
  return {
    plate: body.plate ?? result.plate,
    color: body.color,
    cochera: body.cochera,
    notes: body.notes,
    enteredAt: body.enteredAt ?? result.enteredAt,
    leftAt: body.leftAt ?? result.leftAt,
    vehicleBrand: body.vehicleBrand,
    vehicleModel: body.vehicleModel,
    rateId: body.rateId,
    rateSnapshotName: body.rateSnapshotName,
    rateSnapshotHourPriceArs:
      body.rateSnapshotHourPriceArs !== undefined
        ? String(body.rateSnapshotHourPriceArs)
        : result.rateSnapshotHourPriceArs,
    rateSnapshotStayPriceArs:
      body.rateSnapshotStayPriceArs !== undefined
        ? String(body.rateSnapshotStayPriceArs)
        : result.rateSnapshotStayPriceArs,
    rateSnapshotFractionPriceArs:
      body.rateSnapshotFractionPriceArs !== undefined
        ? String(body.rateSnapshotFractionPriceArs)
        : result.rateSnapshotFractionPriceArs,
    amountPaid:
      body.payments !== undefined
        ? String(body.payments.reduce((sum, line) => sum + line.amount, 0))
        : result.amountPaid,
  };
}

export function EntryEditDialog({
  entry,
  tenantId,
  accessToken,
  actorRole,
  cashSession,
  onClose,
}: Props) {
  const { isOnline } = useNetwork();
  const { showToast } = useToast();
  const readOnly = Boolean(cashSession?.closedAt);
  const isActiveEntry = !entry.leftAt;
  const [saving, setSaving] = useState(false);
  const [plate, setPlate] = useState(entry.plate);
  const [vehicleBrand, setVehicleBrand] = useState(entry.vehicleBrand ?? '');
  const [vehicleModel, setVehicleModel] = useState(entry.vehicleModel ?? '');
  const [color, setColor] = useState(entry.color ?? '');
  const [cochera, setCochera] = useState(entry.cochera ?? '');
  const [notes, setNotes] = useState(entry.notes ?? '');
  const [enteredAt, setEnteredAt] = useState(isoToInputValue(entry.enteredAt));
  const [leftAt, setLeftAt] = useState(isoToInputValue(entry.leftAt));
  const [rateId, setRateId] = useState(entry.rateId ?? '');
  const [reason, setReason] = useState('');

  const rates = useLiveQuery(
    () =>
      localDb.rates
        .where('tenantId')
        .equals(tenantId)
        .filter((rate) => !rate.deletedAt)
        .toArray(),
    [tenantId],
  );

  const paymentMethods = useLiveQuery(
    () =>
      localDb.paymentMethods
        .where('tenantId')
        .equals(tenantId)
        .filter((pm) => pm.enabled)
        .toArray(),
    [tenantId],
  );

  const pms = paymentMethods ?? [];
  const [paymentLines, setPaymentLines] = useState<PaymentFormLine[]>(() =>
    toPaymentLines(entry, pms),
  );

  useEffect(() => {
    if (!paymentMethods || entry.paymentLines.length > 0 || !entry.amountPaid) {
      return;
    }
    setPaymentLines((current) =>
      current.length === 1 && current[0].paymentMethodName === 'Sin medio'
        ? toPaymentLines(entry, paymentMethods)
        : current,
    );
  }, [entry, paymentMethods]);

  const selectedRate = useMemo<LocalRate | undefined>(() => {
    return (rates ?? []).find((rate) => rate.id === rateId);
  }, [rateId, rates]);
  const rateChanged = rateId !== (entry.rateId ?? '');

  const rateSnapshot =
    rateChanged && selectedRate
      ? {
          rateId: selectedRate.id,
          rateSnapshotName: selectedRate.name,
          rateSnapshotHourPriceArs: parseMoney(selectedRate.hourPriceArs),
          rateSnapshotStayPriceArs: parseMoney(selectedRate.stayPriceArs),
          rateSnapshotFractionPriceArs: parseMoney(
            selectedRate.fractionPriceArs,
          ),
        }
      : {
          rateId: entry.rateId,
          rateSnapshotName: entry.rateSnapshotName,
          rateSnapshotHourPriceArs: parseMoney(
            entry.rateSnapshotHourPriceArs ?? '0',
          ),
          rateSnapshotStayPriceArs: parseMoney(
            entry.rateSnapshotStayPriceArs ?? '0',
          ),
          rateSnapshotFractionPriceArs: parseMoney(
            entry.rateSnapshotFractionPriceArs ?? '0',
          ),
        };

  const nextEnteredAt = inputValueToIso(enteredAt);
  const nextLeftAt = inputValueToIso(leftAt);
  const paymentTotal = paymentLines.reduce(
    (sum, line) => sum + parseMoney(line.amount),
    0,
  );
  const suggestedAmount =
    nextEnteredAt && nextLeftAt
      ? calcSuggestedAmount(
          nextEnteredAt,
          nextLeftAt,
          rateSnapshot.rateSnapshotHourPriceArs,
          rateSnapshot.rateSnapshotStayPriceArs,
          rateSnapshot.rateSnapshotFractionPriceArs,
        )
      : 0;
  const amountMismatch =
    !isActiveEntry &&
    (enteredAt !== isoToInputValue(entry.enteredAt) ||
      leftAt !== isoToInputValue(entry.leftAt) ||
      rateId !== (entry.rateId ?? '')) &&
    Math.abs(paymentTotal - suggestedAmount) > 0.005;
  const originalPayments = useMemo(
    () => paymentIdentity(toPaymentLines(entry, pms)),
    [entry, pms],
  );
  const originalPaymentTotal = useMemo(
    () =>
      toPaymentLines(entry, pms).reduce(
        (sum, line) => sum + parseMoney(line.amount),
        0,
      ),
    [entry, pms],
  );
  const currentPayments = paymentIdentity(paymentLines);
  const paymentsChanged = currentPayments !== originalPayments;
  const timeChanged =
    enteredAt !== isoToInputValue(entry.enteredAt) ||
    leftAt !== isoToInputValue(entry.leftAt);
  const rateOrTimeChanged = timeChanged || rateChanged;
  const paymentAmountChanged =
    Math.abs(paymentTotal - originalPaymentTotal) > 0.005;
  const reasonRequired =
    actorRole === 'operator' && (timeChanged || paymentAmountChanged);
  const hasRateSnapshot = Boolean(
    rateSnapshot.rateId || rateSnapshot.rateSnapshotName,
  );

  const body: CorrectEntryDto = {
    plate: plate.trim().toUpperCase(),
    color: color.trim(),
    cochera: cochera.trim(),
    notes: notes.trim(),
    enteredAt: nextEnteredAt,
    vehicleBrand: vehicleBrand.trim(),
    vehicleModel: vehicleModel.trim(),
    ...(hasRateSnapshot
      ? {
          rateId: rateSnapshot.rateId,
          rateSnapshotName: rateSnapshot.rateSnapshotName,
          rateSnapshotHourPriceArs: rateSnapshot.rateSnapshotHourPriceArs,
          rateSnapshotStayPriceArs: rateSnapshot.rateSnapshotStayPriceArs,
          rateSnapshotFractionPriceArs:
            rateSnapshot.rateSnapshotFractionPriceArs,
        }
      : {}),
    ...(isActiveEntry ? {} : { leftAt: nextLeftAt }),
    ...(paymentsChanged || (!isActiveEntry && rateOrTimeChanged)
      ? {
          payments: paymentLines
            .map<CorrectEntryPaymentLineDto>((line) => ({
              id: generateUuidV7(),
              paymentMethodId: line.paymentMethodId,
              paymentMethodName: line.paymentMethodName,
              amount: Math.round(parseMoney(line.amount) * 100) / 100,
            }))
            .filter((line) => line.amount > 0),
        }
      : {}),
    ...(reasonRequired ? { reason: reason.trim() } : {}),
  };

  const changed =
    body.plate !== entry.plate ||
    body.color !== (entry.color ?? '') ||
    body.cochera !== (entry.cochera ?? '') ||
    body.notes !== (entry.notes ?? '') ||
    body.enteredAt !== entry.enteredAt ||
    body.leftAt !== entry.leftAt ||
    body.vehicleBrand !== (entry.vehicleBrand ?? '') ||
    body.vehicleModel !== (entry.vehicleModel ?? '') ||
    body.rateId !== entry.rateId ||
    body.rateSnapshotName !== entry.rateSnapshotName ||
    (body.rateSnapshotHourPriceArs !== undefined &&
      body.rateSnapshotHourPriceArs !==
        parseMoney(entry.rateSnapshotHourPriceArs ?? '0')) ||
    (body.rateSnapshotStayPriceArs !== undefined &&
      body.rateSnapshotStayPriceArs !==
        parseMoney(entry.rateSnapshotStayPriceArs ?? '0')) ||
    (body.rateSnapshotFractionPriceArs !== undefined &&
      body.rateSnapshotFractionPriceArs !==
        parseMoney(entry.rateSnapshotFractionPriceArs ?? '0')) ||
    paymentsChanged;

  const valid =
    !readOnly &&
    changed &&
    !!body.plate &&
    !!body.enteredAt &&
    (isActiveEntry || !!body.leftAt) &&
    !amountMismatch &&
    (!reasonRequired || reason.trim().length > 0);

  function updatePaymentLine(
    id: string,
    patch: Partial<PaymentFormLine>,
  ): void {
    setPaymentLines((current) =>
      current.map((line) => (line.id === id ? { ...line, ...patch } : line)),
    );
  }

  function addPaymentLine(): void {
    const pm = pms.find((item) => item.isDefault) ?? pms[0];
    setPaymentLines((current) => [
      ...current,
      {
        id: generateUuidV7(),
        paymentMethodId: pm?.id,
        paymentMethodName: pm?.name ?? 'Sin medio',
        amount: '',
      },
    ]);
  }

  async function handleSave(): Promise<void> {
    if (!valid) return;
    setSaving(true);
    const now = new Date().toISOString();
    try {
      if (isOnline) {
        const result = await correctEntry({
          tenantId,
          entryId: entry.id,
          expectedVersion: entry.version,
          bearer: accessToken,
          body,
        });
        await localDb.transaction(
          'rw',
          localDb.entries,
          localDb.paymentTransactions,
          async () => {
            await localDb.entries.update(entry.id, {
              plate: result.plate,
              color: result.color ?? undefined,
              cochera: result.cochera ?? undefined,
              notes: result.notes ?? undefined,
              enteredAt: result.enteredAt,
              leftAt: result.leftAt ?? undefined,
              amountPaid:
                result.amountPaid !== null
                  ? String(result.amountPaid)
                  : undefined,
              vehicleBrand: result.vehicleBrand ?? undefined,
              vehicleModel: result.vehicleModel ?? undefined,
              rateId: result.rateId ?? undefined,
              rateSnapshotName: result.rateSnapshotName ?? undefined,
              rateSnapshotHourPriceArs:
                result.rateSnapshotHourPriceArs !== null
                  ? String(result.rateSnapshotHourPriceArs)
                  : undefined,
              rateSnapshotStayPriceArs:
                result.rateSnapshotStayPriceArs !== null
                  ? String(result.rateSnapshotStayPriceArs)
                  : undefined,
              rateSnapshotFractionPriceArs:
                result.rateSnapshotFractionPriceArs !== null
                  ? String(result.rateSnapshotFractionPriceArs)
                  : undefined,
              version: result.version,
              syncSeq: result.syncSeq,
              updatedAt: result.updatedAt,
            });
            if (body.payments !== undefined) {
              await localDb.paymentTransactions
                .where('entryId')
                .equals(entry.id)
                .delete();
              await localDb.paymentTransactions.bulkPut(
                body.payments.map((line) => ({
                  id: line.id,
                  tenantId,
                  entryId: entry.id,
                  cashSessionId: entry.cashSessionId,
                  paymentMethodId: line.paymentMethodId,
                  paymentMethodName: line.paymentMethodName,
                  amount: line.amount,
                  version: 1,
                  syncSeq: 0,
                  updatedAt: now,
                })),
              );
            }
          },
        );
      } else {
        await localDb.transaction(
          'rw',
          localDb.entries,
          localDb.paymentTransactions,
          localDb.pendingOps,
          async () => {
            await localDb.entries.update(entry.id, {
              ...entryToPatch(entry, body),
              version: entry.version + 1,
              updatedAt: now,
            });
            if (body.payments !== undefined) {
              await localDb.paymentTransactions
                .where('entryId')
                .equals(entry.id)
                .delete();
              await localDb.paymentTransactions.bulkPut(
                body.payments.map((line) => ({
                  id: line.id,
                  tenantId,
                  entryId: entry.id,
                  cashSessionId: entry.cashSessionId,
                  paymentMethodId: line.paymentMethodId,
                  paymentMethodName: line.paymentMethodName,
                  amount: line.amount,
                  version: 1,
                  syncSeq: 0,
                  updatedAt: now,
                })),
              );
            }
            await localDb.pendingOps.add({
              entityType: 'entry',
              operation: 'update',
              tenantId,
              entityId: entry.id,
              payload: {
                kind: 'correction',
                expectedVersion: entry.version,
                body,
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
          ? 'Movimiento actualizado.'
          : 'Movimiento actualizado localmente.',
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
    <div className="rate-dialog-backdrop" role="presentation">
      <section
        className="rate-dialog entry-edit-dialog"
        role="dialog"
        aria-modal
      >
        <header className="rate-dialog-header">
          <div>
            <p className="rate-dialog-kicker">Historial</p>
            <h3>Editar movimiento</h3>
            {readOnly ? (
              <p className="muted">
                La caja está cerrada. Este movimiento no se puede editar.
              </p>
            ) : null}
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

        <div className="entry-edit-body">
          <div className="entry-edit-grid">
            <label className="form-label">
              Patente
              <input
                value={plate}
                disabled={readOnly}
                onChange={(event) => setPlate(event.target.value)}
              />
            </label>
            <label className="form-label">
              Marca
              <input
                value={vehicleBrand}
                disabled={readOnly}
                onChange={(event) => setVehicleBrand(event.target.value)}
              />
            </label>
            <label className="form-label">
              Modelo
              <input
                value={vehicleModel}
                disabled={readOnly}
                onChange={(event) => setVehicleModel(event.target.value)}
              />
            </label>
            <label className="form-label">
              Color
              <input
                value={color}
                disabled={readOnly}
                onChange={(event) => setColor(event.target.value)}
              />
            </label>
            <label className="form-label">
              Cochera
              <input
                value={cochera}
                disabled={readOnly}
                onChange={(event) => setCochera(event.target.value)}
              />
            </label>
            <label className="form-label">
              Tarifa
              <select
                value={rateId}
                disabled={readOnly}
                onChange={(event) => setRateId(event.target.value)}
              >
                <option value="">Sin tarifa</option>
                {(rates ?? []).map((rate) => (
                  <option value={rate.id} key={rate.id}>
                    {rate.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="form-label">
              Ingreso
              <input
                type="datetime-local"
                value={enteredAt}
                disabled={readOnly}
                onChange={(event) => setEnteredAt(event.target.value)}
              />
            </label>
            <label className="form-label">
              Egreso
              <input
                type="datetime-local"
                value={leftAt}
                disabled={readOnly || isActiveEntry}
                onChange={(event) => setLeftAt(event.target.value)}
              />
            </label>
          </div>

          <label className="form-label">
            Notas
            <textarea
              value={notes}
              disabled={readOnly}
              onChange={(event) => setNotes(event.target.value)}
            />
          </label>

          {!isActiveEntry ? (
            <section className="entry-edit-payments">
              <div className="entry-edit-payments-head">
                <div>
                  <span className="form-label">Cobro</span>
                  <p className="muted">
                    Sugerido: {formatArs(suggestedAmount)} · Total:{' '}
                    {formatArs(paymentTotal)}
                  </p>
                </div>
                <button
                  type="button"
                  className="dt-secondary-action"
                  onClick={addPaymentLine}
                  disabled={readOnly}
                >
                  <Plus size={15} />
                  Agregar
                </button>
              </div>
              {paymentLines.map((line) => (
                <div className="entry-edit-payment-row" key={line.id}>
                  <select
                    value={line.paymentMethodId ?? ''}
                    disabled={readOnly}
                    onChange={(event) => {
                      const pm = pms.find(
                        (item) => item.id === event.target.value,
                      );
                      updatePaymentLine(line.id, {
                        paymentMethodId: pm?.id,
                        paymentMethodName: pm?.name ?? line.paymentMethodName,
                      });
                    }}
                  >
                    <option value="">{line.paymentMethodName}</option>
                    {pms.map((pm) => (
                      <option value={pm.id} key={pm.id}>
                        {pm.name}
                      </option>
                    ))}
                  </select>
                  <input
                    inputMode="decimal"
                    value={line.amount}
                    disabled={readOnly}
                    onChange={(event) =>
                      updatePaymentLine(line.id, { amount: event.target.value })
                    }
                  />
                  <button
                    type="button"
                    className="table-icon-action danger"
                    onClick={() =>
                      setPaymentLines((current) =>
                        current.filter((item) => item.id !== line.id),
                      )
                    }
                    disabled={readOnly}
                    title="Quitar medio"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
              {amountMismatch ? (
                <p className="field-error">
                  Si cambiás tarifa u horarios, el total debe coincidir con el
                  sugerido.
                </p>
              ) : null}
            </section>
          ) : null}

          {reasonRequired ? (
            <label className="form-label">
              Razón
              <textarea
                value={reason}
                disabled={readOnly}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Explicá por qué se corrige el horario o el monto."
              />
            </label>
          ) : null}
        </div>

        <div className="rate-dialog-actions">
          <button
            type="button"
            className="btn ghost"
            onClick={onClose}
            disabled={saving}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="btn primary"
            onClick={() => void handleSave()}
            disabled={!valid || saving}
          >
            <Save size={16} />
            Guardar
          </button>
        </div>
      </section>
    </div>
  );
}
