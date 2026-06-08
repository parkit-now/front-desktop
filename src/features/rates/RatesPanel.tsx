import type { ColumnDef } from '@tanstack/react-table';
import { useLiveQuery } from 'dexie-react-hooks';
import { Pencil, Plus, Power, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { DataTable, type DataTableFilterOption } from '../data-table';
import {
  createRate,
  deactivateRate as deleteRateApi,
  type CreateRateDto,
  type RateDto,
  type UpdateRateDto,
  updateRate,
} from '../../lib/api/rates';
import { translateApiError } from '../../lib/api/translate';
import { localDb, type LocalRate } from '../../lib/db/localDb';
import {
  formatArgentinaDateTime,
  formatArs,
  toMoneyInputString,
  toMoneyNumber,
} from '../../lib/format/argentina';
import { useNetwork } from '../../lib/network/NetworkContext';
import { useToast } from '../../lib/notifications/ToastProvider';
import { useSync } from '../../lib/sync/SyncContext';
import { ConfirmDialog } from '../../lib/ui/ConfirmDialog';

type Props = {
  accessToken: string;
  userId: string;
  tenantId: string;
  canManage: boolean;
};

type EditorMode = 'create' | 'edit';

type FormState = {
  name: string;
  hourPriceArs: string;
  stayPriceArs: string;
  fractionPriceArs: string;
  shortcutNumber: string;
};

type FormErrors = {
  name?: string;
  hourPriceArs?: string;
  stayPriceArs?: string;
  fractionPriceArs?: string;
  shortcutNumber?: string;
};

type RateConfirmAction = {
  kind: 'deactivate' | 'activate' | 'delete';
  rate: RateDto;
};

const STATUS_FILTER_OPTIONS: DataTableFilterOption[] = [
  { value: 'Activa', label: 'Activa' },
  { value: 'Inactiva', label: 'Inactiva' },
];

function rateStatus(rate: RateDto): 'Activa' | 'Inactiva' {
  return rate.isActive ? 'Activa' : 'Inactiva';
}

function localToDisplay(r: LocalRate): RateDto {
  return {
    id: r.id,
    tenantId: r.tenantId,
    name: r.name,
    hourPriceArs: parseFloat(r.hourPriceArs),
    stayPriceArs: parseFloat(r.stayPriceArs),
    fractionPriceArs: parseFloat(r.fractionPriceArs),
    isActive: r.isActive,
    shortcutNumber: r.shortcutNumber ?? null,
    version: r.version,
    syncSeq: r.syncSeq,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

function apiToLocal(r: RateDto): LocalRate {
  return {
    id: r.id,
    tenantId: r.tenantId,
    name: r.name,
    hourPriceArs: String(r.hourPriceArs),
    stayPriceArs: String(r.stayPriceArs),
    fractionPriceArs: String(r.fractionPriceArs),
    isActive: r.isActive,
    shortcutNumber: r.shortcutNumber ?? undefined,
    version: r.version,
    syncSeq: r.syncSeq,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

function validateMoney(raw: string): { value?: number; error?: string } {
  const trimmed = raw.trim();

  if (trimmed.length === 0) {
    return { error: 'Este campo es obligatorio.' };
  }

  if (!/^\d+(?:[.,]\d{1,2})?$/.test(trimmed)) {
    return { error: 'Ingresá un número válido con hasta 2 decimales.' };
  }

  const parsed = Number(trimmed.replace(',', '.'));
  if (!Number.isFinite(parsed)) {
    return { error: 'Ingresá un número válido.' };
  }

  if (parsed < 0) {
    return { error: 'No puede ser negativo.' };
  }

  return { value: parsed };
}

function emptyForm(): FormState {
  return {
    name: '',
    hourPriceArs: '',
    stayPriceArs: '',
    fractionPriceArs: '',
    shortcutNumber: '',
  };
}

function fromRate(rate: RateDto): FormState {
  return {
    name: rate.name,
    hourPriceArs: toMoneyInputString(rate.hourPriceArs),
    stayPriceArs: toMoneyInputString(rate.stayPriceArs),
    fractionPriceArs: toMoneyInputString(rate.fractionPriceArs),
    shortcutNumber:
      rate.shortcutNumber != null ? String(rate.shortcutNumber) : '',
  };
}

function generateUuidV7(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);

  const timestamp = BigInt(Date.now());
  bytes[0] = Number((timestamp >> 40n) & 0xffn);
  bytes[1] = Number((timestamp >> 32n) & 0xffn);
  bytes[2] = Number((timestamp >> 24n) & 0xffn);
  bytes[3] = Number((timestamp >> 16n) & 0xffn);
  bytes[4] = Number((timestamp >> 8n) & 0xffn);
  bytes[5] = Number(timestamp & 0xffn);

  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function RatesPanel({
  accessToken,
  userId,
  tenantId,
  canManage,
}: Props) {
  const { showToast } = useToast();
  const { isOnline } = useNetwork();
  const { triggerSync, isSyncing } = useSync();
  const [saving, setSaving] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorMode, setEditorMode] = useState<EditorMode>('create');
  const [editingRate, setEditingRate] = useState<RateDto | null>(null);
  const [confirmAction, setConfirmAction] = useState<RateConfirmAction | null>(
    null,
  );
  const [form, setForm] = useState<FormState>(() => emptyForm());
  const [errors, setErrors] = useState<FormErrors>({});

  // Local-first: rates come from IndexedDB, updated reactively via Dexie
  const localRates = useLiveQuery(
    () => localDb.rates.where('tenantId').equals(tenantId).sortBy('name'),
    [tenantId],
  );

  const rates: RateDto[] = useMemo(
    () => (localRates ?? []).map(localToDisplay),
    [localRates],
  );

  const loading = localRates === undefined || isSyncing;

  useEffect(() => {
    if (!editorOpen) return;

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape' && !saving) {
        closeEditor();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [editorOpen, saving]);

  const canSubmitForm = useMemo(() => {
    const name = form.name.trim();
    const n = parseInt(form.shortcutNumber.trim(), 10);
    return (
      name.length > 0 &&
      name.length <= 120 &&
      !validateMoney(form.hourPriceArs).error &&
      !validateMoney(form.stayPriceArs).error &&
      !validateMoney(form.fractionPriceArs).error &&
      Number.isInteger(n) &&
      n >= 1
    );
  }, [
    form.fractionPriceArs,
    form.hourPriceArs,
    form.name,
    form.shortcutNumber,
    form.stayPriceArs,
  ]);

  function resetEditor(): void {
    setEditorMode('create');
    setEditingRate(null);
    setForm(emptyForm());
    setErrors({});
  }

  function closeEditor(): void {
    if (saving) return;
    setEditorOpen(false);
    resetEditor();
  }

  function beginCreate(): void {
    if (!canManage) return;
    setEditorMode('create');
    setEditingRate(null);
    setErrors({});
    const used = new Set(
      (localRates ?? [])
        .filter((r) => r.shortcutNumber != null)
        .map((r) => r.shortcutNumber!),
    );
    let next = 1;
    while (used.has(next)) next++;
    setForm({ ...emptyForm(), shortcutNumber: String(next) });
    setEditorOpen(true);
  }

  function beginEdit(rate: RateDto): void {
    if (!canManage) return;
    setEditorMode('edit');
    setEditingRate(rate);
    setForm(fromRate(rate));
    setErrors({});
    setEditorOpen(true);
  }

  function validateForm(): {
    payload?: {
      name: string;
      hourPriceArs: number;
      stayPriceArs: number;
      fractionPriceArs: number;
      shortcutNumber: number;
    };
  } {
    const nextErrors: FormErrors = {};

    const name = form.name.trim();
    if (name.length === 0) {
      nextErrors.name = 'El nombre es obligatorio.';
    } else if (name.length > 120) {
      nextErrors.name = 'Máximo 120 caracteres.';
    }

    const hour = validateMoney(form.hourPriceArs);
    if (hour.error) nextErrors.hourPriceArs = hour.error;

    const stay = validateMoney(form.stayPriceArs);
    if (stay.error) nextErrors.stayPriceArs = stay.error;

    const fraction = validateMoney(form.fractionPriceArs);
    if (fraction.error) nextErrors.fractionPriceArs = fraction.error;

    const shortcutRaw = form.shortcutNumber.trim();
    const shortcutN = parseInt(shortcutRaw, 10);
    let shortcutNumber = 0;
    if (shortcutRaw.length === 0) {
      nextErrors.shortcutNumber = 'El número de atajo es obligatorio.';
    } else if (
      !Number.isInteger(shortcutN) ||
      shortcutN < 1 ||
      String(shortcutN) !== shortcutRaw
    ) {
      nextErrors.shortcutNumber = 'Debe ser un entero positivo.';
    } else {
      const conflict = (localRates ?? []).find(
        (r) => r.shortcutNumber === shortcutN && r.id !== editingRate?.id,
      );
      if (conflict) {
        nextErrors.shortcutNumber = `El número ${shortcutN} ya está ocupado por "${conflict.name}".`;
      } else {
        shortcutNumber = shortcutN;
      }
    }

    setErrors(nextErrors);

    if (Object.keys(nextErrors).length > 0) {
      return {};
    }

    return {
      payload: {
        name,
        hourPriceArs: hour.value ?? 0,
        stayPriceArs: stay.value ?? 0,
        fractionPriceArs: fraction.value ?? 0,
        shortcutNumber,
      },
    };
  }

  async function handleSubmit(
    event: React.FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    if (!canManage) return;

    const { payload } = validateForm();
    if (!payload) return;

    setSaving(true);

    try {
      if (editorMode === 'create') {
        const id = generateUuidV7();
        const now = new Date().toISOString();
        const body: CreateRateDto = {
          id,
          name: payload.name,
          hourPriceArs: payload.hourPriceArs,
          stayPriceArs: payload.stayPriceArs,
          fractionPriceArs: payload.fractionPriceArs,
          shortcutNumber: payload.shortcutNumber,
        };

        if (isOnline) {
          const result = await createRate({
            tenantId,
            bearer: accessToken,
            body,
          });
          await localDb.rates.put(apiToLocal(result));
        } else {
          const localRate: LocalRate = {
            id,
            tenantId,
            name: payload.name,
            hourPriceArs: String(payload.hourPriceArs),
            stayPriceArs: String(payload.stayPriceArs),
            fractionPriceArs: String(payload.fractionPriceArs),
            isActive: true,
            shortcutNumber: payload.shortcutNumber,
            version: 1,
            syncSeq: 0,
            createdAt: now,
            updatedAt: now,
          };
          await localDb.transaction(
            'rw',
            localDb.rates,
            localDb.pendingOps,
            async () => {
              await localDb.rates.put(localRate);
              await localDb.pendingOps.add({
                entityType: 'rate',
                operation: 'create',
                tenantId,
                entityId: id,
                payload: body,
                status: 'pending',
                createdAt: Date.now(),
                retryCount: 0,
              });
            },
          );
        }

        showToast({
          message: isOnline ? 'Tasa creada.' : 'Tasa guardada localmente.',
          kind: 'success',
        });
      } else if (editingRate) {
        const body: UpdateRateDto = {};
        const currentHourPrice = toMoneyNumber(editingRate.hourPriceArs);
        const currentStayPrice = toMoneyNumber(editingRate.stayPriceArs);
        const currentFractionPrice = toMoneyNumber(
          editingRate.fractionPriceArs,
        );

        if (payload.name !== editingRate.name) body.name = payload.name;
        if (payload.hourPriceArs !== currentHourPrice)
          body.hourPriceArs = payload.hourPriceArs;
        if (payload.stayPriceArs !== currentStayPrice)
          body.stayPriceArs = payload.stayPriceArs;
        if (payload.fractionPriceArs !== currentFractionPrice)
          body.fractionPriceArs = payload.fractionPriceArs;
        if (payload.shortcutNumber !== editingRate.shortcutNumber)
          body.shortcutNumber = payload.shortcutNumber;

        if (Object.keys(body).length === 0) {
          showToast({ message: 'No hay cambios para guardar.', kind: 'info' });
          setSaving(false);
          return;
        }

        if (isOnline) {
          const result = await updateRate({
            tenantId,
            rateId: editingRate.id,
            expectedVersion: editingRate.version,
            bearer: accessToken,
            body,
          });
          await localDb.rates.put(apiToLocal(result));
        } else {
          await localDb.transaction(
            'rw',
            localDb.rates,
            localDb.pendingOps,
            async () => {
              await localDb.rates.update(editingRate.id, {
                ...body,
                hourPriceArs:
                  body.hourPriceArs !== undefined
                    ? String(body.hourPriceArs)
                    : undefined,
                stayPriceArs:
                  body.stayPriceArs !== undefined
                    ? String(body.stayPriceArs)
                    : undefined,
                fractionPriceArs:
                  body.fractionPriceArs !== undefined
                    ? String(body.fractionPriceArs)
                    : undefined,
                shortcutNumber: body.shortcutNumber,
                updatedAt: new Date().toISOString(),
              });
              await localDb.pendingOps.add({
                entityType: 'rate',
                operation: 'update',
                tenantId,
                entityId: editingRate.id,
                payload: { expectedVersion: editingRate.version, body },
                status: 'pending',
                createdAt: Date.now(),
                retryCount: 0,
              });
            },
          );
        }

        showToast({
          message: isOnline
            ? 'Tasa actualizada.'
            : 'Cambios guardados localmente.',
          kind: 'success',
        });
      }

      setEditorOpen(false);
      resetEditor();
    } catch (error) {
      showToast({ message: translateApiError(error), kind: 'error' });
    } finally {
      setSaving(false);
    }
  }

  async function handleConfirmRateAction(): Promise<void> {
    if (!canManage || !confirmAction) return;

    setSaving(true);
    try {
      if (confirmAction.kind === 'deactivate') {
        if (isOnline) {
          const result = await updateRate({
            tenantId,
            rateId: confirmAction.rate.id,
            expectedVersion: confirmAction.rate.version,
            bearer: accessToken,
            body: { isActive: false },
          });
          await localDb.rates.put(apiToLocal(result));
        } else {
          await localDb.transaction(
            'rw',
            localDb.rates,
            localDb.pendingOps,
            async () => {
              await localDb.rates.update(confirmAction.rate.id, {
                isActive: false,
                updatedAt: new Date().toISOString(),
              });
              await localDb.pendingOps.add({
                entityType: 'rate',
                operation: 'update',
                tenantId,
                entityId: confirmAction.rate.id,
                payload: {
                  expectedVersion: confirmAction.rate.version,
                  body: { isActive: false },
                },
                status: 'pending',
                createdAt: Date.now(),
                retryCount: 0,
              });
            },
          );
        }
        showToast({
          message: isOnline ? 'Tasa desactivada.' : 'Desactivada localmente.',
          kind: 'success',
        });
      } else if (confirmAction.kind === 'activate') {
        if (isOnline) {
          const result = await updateRate({
            tenantId,
            rateId: confirmAction.rate.id,
            expectedVersion: confirmAction.rate.version,
            bearer: accessToken,
            body: { isActive: true },
          });
          await localDb.rates.put(apiToLocal(result));
        } else {
          await localDb.transaction(
            'rw',
            localDb.rates,
            localDb.pendingOps,
            async () => {
              await localDb.rates.update(confirmAction.rate.id, {
                isActive: true,
                updatedAt: new Date().toISOString(),
              });
              await localDb.pendingOps.add({
                entityType: 'rate',
                operation: 'update',
                tenantId,
                entityId: confirmAction.rate.id,
                payload: {
                  expectedVersion: confirmAction.rate.version,
                  body: { isActive: true },
                },
                status: 'pending',
                createdAt: Date.now(),
                retryCount: 0,
              });
            },
          );
        }
        showToast({
          message: isOnline ? 'Tasa reactivada.' : 'Reactivada localmente.',
          kind: 'success',
        });
      } else {
        if (isOnline) {
          await deleteRateApi({
            tenantId,
            rateId: confirmAction.rate.id,
            expectedVersion: confirmAction.rate.version,
            bearer: accessToken,
          });
        } else {
          await localDb.pendingOps.add({
            entityType: 'rate',
            operation: 'delete',
            tenantId,
            entityId: confirmAction.rate.id,
            payload: { expectedVersion: confirmAction.rate.version },
            status: 'pending',
            createdAt: Date.now(),
            retryCount: 0,
          });
        }
        await localDb.rates.delete(confirmAction.rate.id);
        showToast({
          message: isOnline ? 'Tasa eliminada.' : 'Eliminada localmente.',
          kind: 'success',
        });
      }

      setConfirmAction(null);
    } catch (error) {
      showToast({ message: translateApiError(error), kind: 'error' });
    } finally {
      setSaving(false);
    }
  }

  const confirmDialogCopy = confirmAction
    ? confirmAction.kind === 'activate'
      ? {
          title: `Reactivar "${confirmAction.rate.name}"`,
          message: 'La tasa volverá a estar disponible para operar.',
          confirmLabel: 'Reactivar',
          variant: 'warning' as const,
        }
      : confirmAction.kind === 'deactivate'
        ? {
            title: `Desactivar "${confirmAction.rate.name}"`,
            message:
              'La tasa quedará oculta de la operación activa. Podés volver a activarla desde la tabla.',
            confirmLabel: 'Desactivar',
            variant: 'warning' as const,
          }
        : {
            title: `Eliminar "${confirmAction.rate.name}"`,
            message:
              'Esta acción es permanente e irreversible. La tasa será eliminada definitivamente.',
            confirmLabel: 'Eliminar',
            variant: 'danger' as const,
          }
    : null;

  const columns = useMemo<ColumnDef<RateDto, unknown>[]>(() => {
    const baseColumns: ColumnDef<RateDto, unknown>[] = [
      {
        accessorKey: 'shortcutNumber',
        header: '#',
        size: 56,
        cell: ({ row }) =>
          row.original.shortcutNumber != null ? (
            <span className="rate-shortcut-badge">
              {row.original.shortcutNumber}
            </span>
          ) : (
            <span className="muted">—</span>
          ),
      },
      {
        accessorKey: 'name',
        header: 'Nombre',
        size: 220,
        cell: ({ row }) => <strong>{row.original.name}</strong>,
      },
      {
        accessorKey: 'hourPriceArs',
        header: 'Hora',
        size: 130,
        cell: ({ row }) => formatArs(row.original.hourPriceArs),
      },
      {
        accessorKey: 'stayPriceArs',
        header: 'Estadía',
        size: 140,
        cell: ({ row }) => formatArs(row.original.stayPriceArs),
      },
      {
        accessorKey: 'fractionPriceArs',
        header: 'Fracción',
        size: 140,
        cell: ({ row }) => formatArs(row.original.fractionPriceArs),
      },
      {
        id: 'status',
        header: 'Estado',
        accessorFn: (rate) => rateStatus(rate),
        size: 120,
        cell: ({ row }) => {
          const inactive = rateStatus(row.original) === 'Inactiva';
          return (
            <span
              className={`status-badge ${inactive ? 'status-muted' : 'status-ok'}`}
            >
              {inactive ? 'Inactiva' : 'Activa'}
            </span>
          );
        },
      },
      {
        accessorKey: 'updatedAt',
        header: 'Actualizada',
        size: 170,
        cell: ({ row }) => formatArgentinaDateTime(row.original.updatedAt),
      },
    ];

    if (!canManage) return baseColumns;

    return [
      ...baseColumns,
      {
        id: 'actions',
        header: 'Acciones',
        enableHiding: false,
        enableSorting: false,
        size: 220,
        cell: ({ row }) => {
          const rate = row.original;
          const inactive = rateStatus(rate) === 'Inactiva';
          return (
            <div className="dt-row-actions">
              <button
                type="button"
                className="table-icon-action"
                onClick={() => beginEdit(rate)}
                disabled={saving}
                title="Editar tasa"
                aria-label={`Editar ${rate.name}`}
              >
                <Pencil size={16} />
              </button>
              <button
                type="button"
                className={`table-icon-action ${inactive ? 'warning' : 'active'}`}
                onClick={() =>
                  setConfirmAction({
                    kind: inactive ? 'activate' : 'deactivate',
                    rate,
                  })
                }
                disabled={saving}
                title={inactive ? 'Reactivar tasa' : 'Desactivar tasa'}
                aria-label={
                  inactive
                    ? `Reactivar ${rate.name}`
                    : `Desactivar ${rate.name}`
                }
              >
                <Power size={16} />
              </button>
              <button
                type="button"
                className="table-icon-action danger"
                onClick={() => setConfirmAction({ kind: 'delete', rate })}
                disabled={saving}
                title="Eliminar tasa"
                aria-label={`Eliminar ${rate.name}`}
              >
                <Trash2 size={16} />
              </button>
            </div>
          );
        },
      },
    ];
  }, [canManage, saving]);

  return (
    <section className="rates-panel">
      <div className="rates-layout readonly">
        <div className="rates-table-card data-table-host">
          <DataTable
            data={rates}
            columns={columns}
            title="Tarifas configuradas"
            subtitle="Filtrá, ordená y guardá vistas para operar más rápido."
            isLoading={loading}
            emptyMessage={
              canManage
                ? 'Creá la primera tasa para empezar a operar con precios desde la app.'
                : 'Todavía no hay tasas configuradas para este estacionamiento.'
            }
            searchPlaceholder="Buscar tasa por nombre..."
            searchableKeys={['name']}
            filterableColumns={['status']}
            filterOptionsByColumn={{ status: STATUS_FILTER_OPTIONS }}
            getRowId={(rate) => rate.id}
            initialPageSize={10}
            templateScope={{ userId, tenantId, tableKey: 'rates' }}
            onRefresh={() => {
              if (isOnline) void triggerSync();
            }}
            refreshDisabled={loading || saving || !isOnline}
            headerAction={
              !canManage ? (
                <span className="status-badge status-muted">Solo lectura</span>
              ) : (
                <button
                  type="button"
                  className="primary-button compact rates-new-button"
                  onClick={beginCreate}
                  disabled={saving}
                >
                  <Plus size={17} />
                  Nueva tasa
                </button>
              )
            }
          />
        </div>
      </div>

      {editorOpen ? (
        <div
          className="rate-dialog-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeEditor();
          }}
        >
          <section
            className="rate-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="rate-dialog-title"
          >
            <header className="rate-dialog-header">
              <div>
                <p className="rate-dialog-kicker">Tasas</p>
                <h3 id="rate-dialog-title">
                  {editorMode === 'create' ? 'Nueva tasa' : 'Editar tasa'}
                </h3>
                <p className="muted">
                  {editorMode === 'create'
                    ? 'Creá una tarifa nueva para el estacionamiento activo.'
                    : 'Esta edición usa control de versión para evitar pisar cambios concurrentes.'}
                </p>
              </div>
              <button
                type="button"
                className="rate-dialog-close"
                onClick={closeEditor}
                disabled={saving}
                aria-label="Cerrar editor de tasa"
              >
                <X size={18} />
              </button>
            </header>

            <form
              className="auth-form rate-dialog-form"
              onSubmit={(event) => {
                void handleSubmit(event);
              }}
            >
              <div className="rate-dialog-grid">
                <div className="form-field">
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder="Nº atajo (ej. 1)"
                    value={form.shortcutNumber}
                    onChange={(event) => {
                      setForm((prev) => ({
                        ...prev,
                        shortcutNumber: event.target.value,
                      }));
                    }}
                    className={
                      errors.shortcutNumber ? 'input-error' : undefined
                    }
                    autoFocus
                  />
                  {errors.shortcutNumber ? (
                    <p className="field-error">{errors.shortcutNumber}</p>
                  ) : null}
                </div>

                <div className="form-field" style={{ gridColumn: 'span 2' }}>
                  <input
                    type="text"
                    placeholder="Nombre (ej. DIA AUTO)"
                    value={form.name}
                    onChange={(event) => {
                      setForm((prev) => ({
                        ...prev,
                        name: event.target.value,
                      }));
                    }}
                    className={errors.name ? 'input-error' : undefined}
                  />
                  {errors.name ? (
                    <p className="field-error">{errors.name}</p>
                  ) : null}
                </div>
              </div>

              <div className="rate-dialog-grid">
                <div className="form-field">
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder="Precio hora"
                    value={form.hourPriceArs}
                    onChange={(event) => {
                      setForm((prev) => ({
                        ...prev,
                        hourPriceArs: event.target.value,
                      }));
                    }}
                    className={errors.hourPriceArs ? 'input-error' : undefined}
                  />
                  {errors.hourPriceArs ? (
                    <p className="field-error">{errors.hourPriceArs}</p>
                  ) : null}
                </div>

                <div className="form-field">
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder="Precio estadía"
                    value={form.stayPriceArs}
                    onChange={(event) => {
                      setForm((prev) => ({
                        ...prev,
                        stayPriceArs: event.target.value,
                      }));
                    }}
                    className={errors.stayPriceArs ? 'input-error' : undefined}
                  />
                  {errors.stayPriceArs ? (
                    <p className="field-error">{errors.stayPriceArs}</p>
                  ) : null}
                </div>

                <div className="form-field">
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder="Precio fracción"
                    value={form.fractionPriceArs}
                    onChange={(event) => {
                      setForm((prev) => ({
                        ...prev,
                        fractionPriceArs: event.target.value,
                      }));
                    }}
                    className={
                      errors.fractionPriceArs ? 'input-error' : undefined
                    }
                  />
                  {errors.fractionPriceArs ? (
                    <p className="field-error">{errors.fractionPriceArs}</p>
                  ) : null}
                </div>
              </div>

              <p className="form-helper">
                {editorMode === 'create'
                  ? 'Las tasas nuevas se crean activas. Podés activarlas o desactivarlas desde la tabla.'
                  : 'Para cambiar el estado de la tasa usá el botón de activar/desactivar en la tabla.'}
              </p>

              <div className="rate-dialog-actions">
                <button
                  type="button"
                  className="ghost-button"
                  onClick={closeEditor}
                  disabled={saving}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="primary-button compact"
                  disabled={saving || !canSubmitForm}
                >
                  {saving
                    ? 'Guardando...'
                    : editorMode === 'create'
                      ? 'Crear tasa'
                      : 'Guardar cambios'}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {confirmDialogCopy ? (
        <ConfirmDialog
          open={confirmAction !== null}
          title={confirmDialogCopy.title}
          message={confirmDialogCopy.message}
          confirmLabel={confirmDialogCopy.confirmLabel}
          variant={confirmDialogCopy.variant}
          isPending={saving}
          onCancel={() => {
            if (!saving) setConfirmAction(null);
          }}
          onConfirm={handleConfirmRateAction}
        />
      ) : null}
    </section>
  );
}
