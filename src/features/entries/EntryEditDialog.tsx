import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Printer, Save, Trash2, TriangleAlert, X } from 'lucide-react';
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
  type PaymentMethodKind,
} from '../../lib/db/localDb';
import { enqueuePendingOp } from '../../lib/sync/enqueue';
import { formatArs } from '../../lib/format/argentina';
import { useNetwork } from '../../lib/network/NetworkContext';
import { useToast } from '../../lib/notifications/ToastProvider';
import {
  describePrintFailure,
  printEntryTicket,
} from '../../lib/print/printTicket';
import { calcSuggestedAmount, generateUuidV7 } from './entryUtils';
import { sortByName } from '../payment-methods/paymentMethodUtils';

type ActorRole = 'admin' | 'owner' | 'operator' | null;

type EditableEntry = LocalEntry & {
  paymentLines: LocalPaymentTransaction[];
};

type PaymentFormLine = {
  id: string;
  paymentMethodId?: string;
  paymentMethodName: string;
  /**
   * El tipo viaja junto al nombre porque los dos son el mismo snapshot: es lo
   * que el arqueo de caja usa para saber si esta línea entró al cajón. Una
   * corrección BORRA y RECREA las transacciones, así que si el tipo no se
   * arrastra acá, corregir un cobro en efectivo lo convierte en "otros
   * medios" y descuadra la caja.
   */
  paymentMethodType?: PaymentMethodKind;
  amount: string;
};

interface Props {
  entry: EditableEntry;
  tenantId: string;
  accessToken: string;
  actorRole: ActorRole;
  cashSession?: LocalCashSession;
  /** Encabezado del ticket reimpreso. */
  parkingName?: string | null;
  parkingAddress?: string | null;
  parkingCuit?: string | null;
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

function formatSignedArs(value: number): string {
  const abs = Math.abs(value);
  if (abs <= 0.005) return formatArs(0);
  return `${value > 0 ? '+' : '-'}${formatArs(abs)}`;
}

function isUuid(value: string | undefined): value is string {
  return Boolean(
    value &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    ),
  );
}

function changedText(next: string, current: string | undefined): boolean {
  return next !== (current ?? '');
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
      paymentMethodType: line.paymentMethodType,
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
        paymentMethodType: fallbackMethod?.type,
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
  const patch: Partial<LocalEntry> = {};
  if (body.plate !== undefined) patch.plate = body.plate;
  if (body.color !== undefined) patch.color = body.color;
  if (body.cochera !== undefined) patch.cochera = body.cochera;
  if (body.notes !== undefined) patch.notes = body.notes;
  if (body.enteredAt !== undefined) patch.enteredAt = body.enteredAt;
  if (body.leftAt !== undefined) patch.leftAt = body.leftAt;
  if (body.vehicleBrand !== undefined) patch.vehicleBrand = body.vehicleBrand;
  if (body.vehicleModel !== undefined) patch.vehicleModel = body.vehicleModel;
  if (body.rateId !== undefined) patch.rateId = body.rateId;
  if (body.rateSnapshotName !== undefined) {
    patch.rateSnapshotName = body.rateSnapshotName;
  }
  if (body.rateSnapshotHourPriceArs !== undefined) {
    patch.rateSnapshotHourPriceArs = String(body.rateSnapshotHourPriceArs);
  }
  if (body.rateSnapshotStayPriceArs !== undefined) {
    patch.rateSnapshotStayPriceArs = String(body.rateSnapshotStayPriceArs);
  }
  if (body.rateSnapshotFractionPriceArs !== undefined) {
    patch.rateSnapshotFractionPriceArs = String(
      body.rateSnapshotFractionPriceArs,
    );
  }
  if (body.rateSnapshotMediaEstadiaPriceArs !== undefined) {
    patch.rateSnapshotMediaEstadiaPriceArs = String(
      body.rateSnapshotMediaEstadiaPriceArs,
    );
  }
  if (body.payments !== undefined) {
    patch.amountPaid = String(
      body.payments.reduce((sum, line) => sum + line.amount, 0),
    );
  }
  return patch;
}

export function EntryEditDialog({
  entry,
  tenantId,
  accessToken,
  actorRole,
  cashSession,
  parkingName = null,
  parkingAddress = null,
  parkingCuit = null,
  onClose,
}: Props) {
  const { isOnline } = useNetwork();
  const { showToast } = useToast();
  const readOnly = Boolean(cashSession?.closedAt);
  const isActiveEntry = !entry.leftAt;
  const [saving, setSaving] = useState(false);
  const [reprinting, setReprinting] = useState(false);
  const reasonRef = useRef<HTMLLabelElement>(null);
  const [plate, setPlate] = useState(entry.plate);
  const [vehicleBrand, setVehicleBrand] = useState(entry.vehicleBrand ?? '');
  const [vehicleModel, setVehicleModel] = useState(entry.vehicleModel ?? '');
  const [color, setColor] = useState(entry.color ?? '');
  const [cochera, setCochera] = useState(entry.cochera ?? '');
  const [notes, setNotes] = useState(entry.notes ?? '');
  const originalEnteredAtInput = isoToInputValue(entry.enteredAt);
  const originalLeftAtInput = isoToInputValue(entry.leftAt);
  const [enteredAt, setEnteredAt] = useState(originalEnteredAtInput);
  const [leftAt, setLeftAt] = useState(originalLeftAtInput);
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

  /**
   * Tarifa GUARDADA del movimiento, sin filtrar por `deletedAt`: un ticket
   * viejo tiene que poder reimprimirse con su número aunque después hayan
   * borrado esa tarifa. Es a propósito distinta de `selectedRate`, que sigue
   * al formulario y puede tener cambios sin guardar.
   */
  const persistedRate = useLiveQuery(
    async () =>
      entry.rateId ? await localDb.rates.get(entry.rateId) : undefined,
    [entry.rateId],
  );

  const paymentMethods = useLiveQuery(
    () =>
      localDb.paymentMethods
        .where('tenantId')
        .equals(tenantId)
        .filter((pm) => pm.enabled)
        .toArray()
        .then(sortByName),
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
          rateSnapshotMediaEstadiaPriceArs: parseMoney(
            selectedRate.mediaEstadiaPriceArs,
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
          rateSnapshotMediaEstadiaPriceArs: parseMoney(
            entry.rateSnapshotMediaEstadiaPriceArs ?? '0',
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
      ? calcSuggestedAmount(nextEnteredAt, nextLeftAt, {
          hour: rateSnapshot.rateSnapshotHourPriceArs,
          fraction: rateSnapshot.rateSnapshotFractionPriceArs,
          mediaEstadia: rateSnapshot.rateSnapshotMediaEstadiaPriceArs,
          stay: rateSnapshot.rateSnapshotStayPriceArs,
        })
      : 0;
  const originalSuggestedAmount =
    entry.enteredAt && entry.leftAt
      ? calcSuggestedAmount(entry.enteredAt, entry.leftAt, {
          hour: parseMoney(entry.rateSnapshotHourPriceArs ?? '0'),
          fraction: parseMoney(entry.rateSnapshotFractionPriceArs ?? '0'),
          mediaEstadia: parseMoney(
            entry.rateSnapshotMediaEstadiaPriceArs ?? '0',
          ),
          stay: parseMoney(entry.rateSnapshotStayPriceArs ?? '0'),
        })
      : 0;
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
    enteredAt !== originalEnteredAtInput || leftAt !== originalLeftAtInput;
  const paymentAmountChanged =
    Math.abs(paymentTotal - originalPaymentTotal) > 0.005;
  const reasonRequired =
    actorRole === 'operator' && (timeChanged || paymentAmountChanged);
  const invalidExitTime =
    !isActiveEntry &&
    nextEnteredAt !== undefined &&
    nextLeftAt !== undefined &&
    new Date(nextLeftAt).getTime() <= new Date(nextEnteredAt).getTime();
  const showSuggestedImpact =
    !isActiveEntry &&
    (timeChanged || rateChanged) &&
    nextEnteredAt !== undefined &&
    nextLeftAt !== undefined &&
    !invalidExitTime;
  const suggestedImpact = suggestedAmount - originalSuggestedAmount;

  const body: CorrectEntryDto = {};
  const nextPlate = plate.trim().toUpperCase();
  const nextColor = color.trim();
  const nextCochera = cochera.trim();
  const nextNotes = notes.trim();
  const nextVehicleBrand = vehicleBrand.trim();
  const nextVehicleModel = vehicleModel.trim();

  if (nextPlate !== entry.plate) body.plate = nextPlate;
  if (changedText(nextColor, entry.color)) body.color = nextColor;
  if (changedText(nextCochera, entry.cochera)) body.cochera = nextCochera;
  if (changedText(nextNotes, entry.notes)) body.notes = nextNotes;
  if (nextEnteredAt && enteredAt !== originalEnteredAtInput) {
    body.enteredAt = nextEnteredAt;
  }
  if (!isActiveEntry && nextLeftAt && leftAt !== originalLeftAtInput) {
    body.leftAt = nextLeftAt;
  }
  if (changedText(nextVehicleBrand, entry.vehicleBrand)) {
    body.vehicleBrand = nextVehicleBrand;
  }
  if (changedText(nextVehicleModel, entry.vehicleModel)) {
    body.vehicleModel = nextVehicleModel;
  }
  if (rateChanged && selectedRate) {
    if (isUuid(selectedRate.id)) {
      body.rateId = selectedRate.id;
    }
    body.rateSnapshotName = selectedRate.name;
    body.rateSnapshotHourPriceArs = parseMoney(selectedRate.hourPriceArs);
    body.rateSnapshotStayPriceArs = parseMoney(selectedRate.stayPriceArs);
    body.rateSnapshotFractionPriceArs = parseMoney(
      selectedRate.fractionPriceArs,
    );
    body.rateSnapshotMediaEstadiaPriceArs = parseMoney(
      selectedRate.mediaEstadiaPriceArs,
    );
  }
  if (paymentsChanged) {
    body.payments = paymentLines
      .map<CorrectEntryPaymentLineDto>((line) => ({
        id: generateUuidV7(),
        ...(isUuid(line.paymentMethodId)
          ? { paymentMethodId: line.paymentMethodId }
          : {}),
        paymentMethodName: line.paymentMethodName,
        ...(line.paymentMethodType
          ? { paymentMethodType: line.paymentMethodType }
          : {}),
        amount: Math.round(parseMoney(line.amount) * 100) / 100,
      }))
      .filter((line) => line.amount > 0);
  }
  if (reasonRequired) {
    body.reason = reason.trim();
  }

  const changed =
    body.plate !== undefined ||
    body.color !== undefined ||
    body.cochera !== undefined ||
    body.notes !== undefined ||
    body.enteredAt !== undefined ||
    body.leftAt !== undefined ||
    body.vehicleBrand !== undefined ||
    body.vehicleModel !== undefined ||
    body.rateSnapshotName !== undefined ||
    body.payments !== undefined;

  const valid =
    !readOnly &&
    changed &&
    !!nextPlate &&
    !!nextEnteredAt &&
    (isActiveEntry || !!nextLeftAt) &&
    !invalidExitTime &&
    (!reasonRequired || reason.trim().length > 0);
  const missingReason = reasonRequired && reason.trim().length === 0;
  const saveBlockedMessage = missingReason
    ? 'Ingresá el motivo del cambio para poder guardar.'
    : invalidExitTime
      ? 'La fecha y hora de egreso debe ser mayor a la de ingreso.'
      : changed
        ? null
        : 'No hay cambios para guardar.';
  // "No hay cambios" es el estado normal al abrir; los otros dos son bloqueos.
  const saveBlockedIsProblem = missingReason || invalidExitTime;

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
        paymentMethodType: pm?.type,
        amount: '',
      },
    ]);
  }

  /**
   * El campo de motivo se renderiza al final de un cuerpo scrolleable y recién
   * aparece cuando el cambio lo exige, o sea que nace fuera de pantalla: el
   * operador ve el guardado bloqueado sin ver qué se lo bloquea. No se le roba
   * el foco a propósito — puede estar tipeando el importe cuando aparece.
   */
  useEffect(() => {
    if (!reasonRequired) return;
    reasonRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [reasonRequired]);

  /**
   * Reimprime el ticket con lo que está GUARDADO, no con el formulario: un
   * cambio sin guardar no puede terminar impreso en un papel que el cliente se
   * lleva y que no coincide con la base.
   */
  async function handleReprint(): Promise<void> {
    setReprinting(true);
    try {
      const outcome = await printEntryTicket(
        {
          parkingName,
          parkingAddress,
          parkingCuit,
          plate: entry.plate,
          vehicleBrand: entry.vehicleBrand ?? null,
          vehicleModel: entry.vehicleModel ?? null,
          color: entry.color ?? null,
          cochera: entry.cochera ?? null,
          notes: entry.notes ?? null,
          enteredAt: entry.enteredAt,
          rateNumber: persistedRate?.shortcutNumber ?? null,
          rateName: persistedRate?.name ?? entry.rateSnapshotName ?? null,
          ticketNumber: entry.ticketNumber ?? null,
        },
        tenantId,
      );
      showToast(
        outcome.ok
          ? { message: 'Ticket reimpreso.', kind: 'success' }
          : { message: describePrintFailure(outcome), kind: 'error' },
      );
    } finally {
      setReprinting(false);
    }
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
              rateSnapshotMediaEstadiaPriceArs:
                result.rateSnapshotMediaEstadiaPriceArs != null
                  ? String(result.rateSnapshotMediaEstadiaPriceArs)
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
                  paymentMethodType: line.paymentMethodType,
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
                  paymentMethodType: line.paymentMethodType,
                  amount: line.amount,
                  version: 1,
                  syncSeq: 0,
                  updatedAt: now,
                })),
              );
            }
            await enqueuePendingOp({
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
    <div
      className="rate-dialog-backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget && !saving) {
          onClose();
        }
      }}
    >
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
                aria-invalid={invalidExitTime}
              />
              {invalidExitTime ? (
                <p className="field-error">
                  El egreso debe ser posterior al ingreso.
                </p>
              ) : null}
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
                  {showSuggestedImpact ? (
                    <p
                      className={
                        suggestedImpact >= 0
                          ? 'entry-edit-impact positive'
                          : 'entry-edit-impact negative'
                      }
                    >
                      Impacto estimado horario/tarifa:{' '}
                      <strong>{formatSignedArs(suggestedImpact)}</strong>
                      <span>
                        {formatArs(originalSuggestedAmount)} -&gt;{' '}
                        {formatArs(suggestedAmount)}
                      </span>
                    </p>
                  ) : null}
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
                        paymentMethodType: pm?.type ?? line.paymentMethodType,
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
            </section>
          ) : null}

          {reasonRequired ? (
            <label
              ref={reasonRef}
              className={`form-label${missingReason ? ' entry-edit-reason--required' : ''}`}
            >
              Motivo del cambio
              <textarea
                value={reason}
                disabled={readOnly}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Explicá por qué se corrige el horario o el monto."
                aria-invalid={missingReason}
              />
              {missingReason ? (
                <p className="field-error">
                  El motivo del cambio es obligatorio para modificar horarios o
                  importes.
                </p>
              ) : null}
            </label>
          ) : null}
        </div>

        <div className="rate-dialog-actions entry-edit-actions">
          <div className="entry-edit-actions-left">
            <button
              type="button"
              className="ghost-button compact"
              onClick={() => void handleReprint()}
              disabled={reprinting}
              title="Volver a imprimir el ticket de ingreso"
            >
              <Printer size={15} aria-hidden="true" />
              {reprinting ? 'Imprimiendo...' : 'Reimprimir ticket'}
            </button>
          </div>
          <div className="entry-edit-actions-right">
            {saveBlockedMessage ? (
              <p
                className={`entry-edit-save-hint${saveBlockedIsProblem ? ' entry-edit-save-hint--blocking' : ''}`}
              >
                {saveBlockedIsProblem ? (
                  <TriangleAlert size={15} aria-hidden="true" />
                ) : null}
                {saveBlockedMessage}
              </p>
            ) : null}
            <button
              type="button"
              className="btn primary entry-edit-save-button"
              onClick={() => void handleSave()}
              disabled={!valid || saving}
              title={saveBlockedMessage ?? 'Guardar cambios'}
            >
              <Save size={16} />
              {saving ? 'Guardando...' : 'Guardar cambios'}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
