import type { ColumnDef } from '@tanstack/react-table';
import { useLiveQuery } from 'dexie-react-hooks';
import { Pencil, Plus, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { DataTable, type DataTableFilterOption } from '../data-table';
import {
  createTenantVehicle,
  updateTenantVehicle,
  deleteTenantVehicle,
} from '../../lib/api/vehicles';
import { translateApiError } from '../../lib/api/translate';
import { localDb, type LocalVehicle } from '../../lib/db/localDb';
import { useNetwork } from '../../lib/network/NetworkContext';
import { useToast } from '../../lib/notifications/ToastProvider';
import { useSync } from '../../lib/sync/SyncContext';
import { ConfirmDialog } from '../../lib/ui/ConfirmDialog';
import { generateUuidV7 } from '../entries/entryUtils';

type Props = {
  accessToken: string;
  userId: string;
  tenantId: string;
  canManage: boolean;
};

type EditorMode = 'create' | 'edit';

type FormState = {
  brand: string;
  model: string;
  type: string;
};

type FormErrors = {
  brand?: string;
  model?: string;
};

type VehicleRow = {
  id: string;
  brand: string;
  model: string;
  type: string | null;
  tenantId: string | null;
  syncSeq: number;
  updatedAt: string;
  createdAt: string;
  isOwn: boolean;
};

const VEHICLE_TYPE_OPTIONS = [
  { value: 'auto', label: 'Auto' },
  { value: 'pickup', label: 'Pickup' },
  { value: 'suv', label: 'SUV' },
  { value: 'van', label: 'Van' },
  { value: 'moto', label: 'Moto' },
  { value: 'camioneta', label: 'Camioneta' },
  { value: 'otro', label: 'Otro' },
];

const TYPE_LABEL: Record<string, string> = {
  auto: 'Auto',
  pickup: 'Pickup',
  suv: 'SUV',
  van: 'Van',
  moto: 'Moto',
  camioneta: 'Camioneta',
  otro: 'Otro',
};

const ORIGIN_FILTER_OPTIONS: DataTableFilterOption[] = [
  { value: 'Global', label: 'Global' },
  { value: 'Propio', label: 'Propio' },
];

function localToRow(v: LocalVehicle, tenantId: string): VehicleRow {
  return {
    id: v.id,
    brand: v.brand,
    model: v.model,
    type: v.type ?? null,
    tenantId: v.tenantId ?? null,
    syncSeq: v.syncSeq,
    updatedAt: v.updatedAt,
    createdAt: v.createdAt,
    isOwn: v.tenantId === tenantId,
  };
}

function emptyForm(): FormState {
  return { brand: '', model: '', type: '' };
}

function fromRow(v: VehicleRow): FormState {
  return { brand: v.brand, model: v.model, type: v.type ?? '' };
}

export function VehiclesPanel({
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
  const [editingVehicle, setEditingVehicle] = useState<VehicleRow | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<VehicleRow | null>(null);
  const [form, setForm] = useState<FormState>(() => emptyForm());
  const [errors, setErrors] = useState<FormErrors>({});

  const localVehicles = useLiveQuery(
    () =>
      localDb.vehicles
        .filter((v) => !v.deletedAt && (!v.tenantId || v.tenantId === tenantId))
        .toArray(),
    [tenantId],
  );

  const vehicles: VehicleRow[] = useMemo(
    () => (localVehicles ?? []).map((v) => localToRow(v, tenantId)),
    [localVehicles, tenantId],
  );

  const loading = localVehicles === undefined || isSyncing;

  useEffect(() => {
    if (!editorOpen) return;
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape' && !saving) closeEditor();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [editorOpen, saving]);

  const canSubmitForm = useMemo(
    () =>
      form.brand.trim().length > 0 &&
      form.brand.trim().length <= 120 &&
      form.model.trim().length > 0 &&
      form.model.trim().length <= 120,
    [form.brand, form.model],
  );

  function resetEditor(): void {
    setEditorMode('create');
    setEditingVehicle(null);
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
    resetEditor();
    setEditorOpen(true);
  }

  function beginEdit(v: VehicleRow): void {
    if (!canManage || !v.isOwn) return;
    setEditorMode('edit');
    setEditingVehicle(v);
    setForm(fromRow(v));
    setErrors({});
    setEditorOpen(true);
  }

  function validateForm(): { payload?: FormState } {
    const nextErrors: FormErrors = {};
    const brand = form.brand.trim();
    const model = form.model.trim();
    if (brand.length === 0) nextErrors.brand = 'La marca es obligatoria.';
    else if (brand.length > 120) nextErrors.brand = 'Máximo 120 caracteres.';
    if (model.length === 0) nextErrors.model = 'El modelo es obligatorio.';
    else if (model.length > 120) nextErrors.model = 'Máximo 120 caracteres.';
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return {};
    return { payload: { brand, model, type: form.type } };
  }

  async function handleSubmit(
    event: React.FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    if (!canManage) return;
    const { payload } = validateForm();
    if (!payload) return;

    const typeValue = payload.type || undefined;

    setSaving(true);
    try {
      if (editorMode === 'create') {
        const id = generateUuidV7();
        const now = new Date().toISOString();
        if (isOnline) {
          const result = await createTenantVehicle({
            tenantId,
            bearer: accessToken,
            body: {
              id,
              brand: payload.brand,
              model: payload.model,
              type: typeValue,
            },
          });
          await localDb.vehicles.put({
            id: result.id,
            brand: result.brand,
            model: result.model,
            type: result.type ?? undefined,
            tenantId: result.tenantId ?? undefined,
            syncSeq: result.syncSeq,
            updatedAt: result.updatedAt,
            createdAt: result.createdAt,
          });
        } else {
          await localDb.transaction(
            'rw',
            [localDb.vehicles, localDb.pendingOps],
            async () => {
              await localDb.vehicles.put({
                id,
                brand: payload.brand,
                model: payload.model,
                type: typeValue,
                tenantId,
                syncSeq: 0,
                updatedAt: now,
                createdAt: now,
              });
              await localDb.pendingOps.add({
                entityType: 'vehicle',
                operation: 'create',
                tenantId,
                entityId: id,
                payload: {
                  id,
                  brand: payload.brand,
                  model: payload.model,
                  type: typeValue,
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
            ? 'Vehículo agregado al catálogo.'
            : 'Vehículo guardado localmente.',
          kind: 'success',
        });
      } else if (editingVehicle) {
        const now = new Date().toISOString();
        const changed =
          payload.brand !== editingVehicle.brand ||
          payload.model !== editingVehicle.model ||
          (typeValue ?? null) !== editingVehicle.type;
        if (!changed) {
          showToast({ message: 'No hay cambios para guardar.', kind: 'info' });
          setSaving(false);
          return;
        }
        if (isOnline) {
          const result = await updateTenantVehicle({
            tenantId,
            bearer: accessToken,
            id: editingVehicle.id,
            body: {
              brand: payload.brand,
              model: payload.model,
              type: typeValue,
            },
          });
          await localDb.vehicles.update(editingVehicle.id, {
            brand: result.brand,
            model: result.model,
            type: result.type ?? undefined,
            syncSeq: result.syncSeq,
            updatedAt: result.updatedAt,
          });
        } else {
          await localDb.transaction(
            'rw',
            [localDb.vehicles, localDb.pendingOps],
            async () => {
              await localDb.vehicles.update(editingVehicle.id, {
                brand: payload.brand,
                model: payload.model,
                type: typeValue,
                updatedAt: now,
              });
              await localDb.pendingOps.add({
                entityType: 'vehicle',
                operation: 'update',
                tenantId,
                entityId: editingVehicle.id,
                payload: {
                  brand: payload.brand,
                  model: payload.model,
                  type: typeValue,
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
            ? 'Vehículo actualizado.'
            : 'Cambio guardado localmente.',
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

  async function handleConfirmDelete(): Promise<void> {
    if (!canManage || !confirmDelete) return;
    setSaving(true);
    try {
      if (isOnline) {
        await deleteTenantVehicle({
          tenantId,
          bearer: accessToken,
          id: confirmDelete.id,
        });
      } else {
        await localDb.pendingOps.add({
          entityType: 'vehicle',
          operation: 'delete',
          tenantId,
          entityId: confirmDelete.id,
          payload: {},
          status: 'pending',
          createdAt: Date.now(),
          retryCount: 0,
        });
      }
      await localDb.vehicles.delete(confirmDelete.id);
      showToast({ message: 'Vehículo eliminado.', kind: 'success' });
      setConfirmDelete(null);
    } catch (error) {
      showToast({ message: translateApiError(error), kind: 'error' });
    } finally {
      setSaving(false);
    }
  }

  const columns = useMemo<ColumnDef<VehicleRow, unknown>[]>(() => {
    const baseColumns: ColumnDef<VehicleRow, unknown>[] = [
      {
        accessorKey: 'brand',
        header: 'Marca',
        size: 160,
        cell: ({ row }) => <strong>{row.original.brand}</strong>,
      },
      {
        accessorKey: 'model',
        header: 'Modelo',
        size: 160,
        cell: ({ row }) => row.original.model,
      },
      {
        id: 'type',
        header: 'Tipo',
        accessorFn: (v) => (v.type ? (TYPE_LABEL[v.type] ?? v.type) : '—'),
        size: 120,
        cell: ({ row }) =>
          row.original.type
            ? (TYPE_LABEL[row.original.type] ?? row.original.type)
            : '—',
      },
      {
        id: 'origin',
        header: 'Origen',
        accessorFn: (v) => (v.isOwn ? 'Propio' : 'Global'),
        size: 110,
        cell: ({ row }) => (
          <span
            className={`status-badge ${row.original.isOwn ? 'status-ok' : 'status-muted'}`}
          >
            {row.original.isOwn ? 'Propio' : 'Global'}
          </span>
        ),
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
        size: 120,
        cell: ({ row }) => {
          const v = row.original;
          if (!v.isOwn) return null;
          return (
            <div className="dt-row-actions">
              <button
                type="button"
                className="table-icon-action"
                onClick={() => beginEdit(v)}
                disabled={saving}
                title="Editar"
                aria-label={`Editar ${v.brand} ${v.model}`}
              >
                <Pencil size={16} />
              </button>
              <button
                type="button"
                className="table-icon-action danger"
                onClick={() => setConfirmDelete(v)}
                disabled={saving}
                title="Eliminar"
                aria-label={`Eliminar ${v.brand} ${v.model}`}
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
            data={vehicles}
            columns={columns}
            title="Catálogo de vehículos"
            subtitle="Vehículos globales del sistema y los propios de este estacionamiento."
            isLoading={loading}
            emptyMessage={
              canManage
                ? 'No hay vehículos en el catálogo. Agregá el primero.'
                : 'No hay vehículos en el catálogo todavía.'
            }
            searchPlaceholder="Buscar por marca o modelo..."
            searchableKeys={['brand', 'model']}
            filterableColumns={['origin']}
            filterOptionsByColumn={{ origin: ORIGIN_FILTER_OPTIONS }}
            getRowId={(v) => v.id}
            initialPageSize={15}
            templateScope={{ userId, tenantId, tableKey: 'vehicles' }}
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
                  Nuevo vehículo
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
            aria-labelledby="vehicle-dialog-title"
          >
            <header className="rate-dialog-header">
              <div>
                <p className="rate-dialog-kicker">Catálogo de vehículos</p>
                <h3 id="vehicle-dialog-title">
                  {editorMode === 'create'
                    ? 'Nuevo vehículo'
                    : 'Editar vehículo'}
                </h3>
                <p className="muted">
                  {editorMode === 'create'
                    ? 'El vehículo quedará disponible solo para este estacionamiento.'
                    : 'Editá la marca, modelo o tipo del vehículo.'}
                </p>
              </div>
              <button
                type="button"
                className="rate-dialog-close"
                onClick={closeEditor}
                disabled={saving}
                aria-label="Cerrar editor"
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
              <div className="form-field">
                <input
                  type="text"
                  placeholder="Marca (ej. Volkswagen)"
                  value={form.brand}
                  onChange={(event) => {
                    setForm((prev) => ({ ...prev, brand: event.target.value }));
                  }}
                  className={errors.brand ? 'input-error' : undefined}
                  maxLength={120}
                  autoFocus
                />
                {errors.brand ? (
                  <p className="field-error">{errors.brand}</p>
                ) : null}
              </div>

              <div className="form-field">
                <input
                  type="text"
                  placeholder="Modelo (ej. Bora)"
                  value={form.model}
                  onChange={(event) => {
                    setForm((prev) => ({ ...prev, model: event.target.value }));
                  }}
                  className={errors.model ? 'input-error' : undefined}
                  maxLength={120}
                />
                {errors.model ? (
                  <p className="field-error">{errors.model}</p>
                ) : null}
              </div>

              <div className="form-field">
                <select
                  value={form.type}
                  onChange={(event) => {
                    setForm((prev) => ({ ...prev, type: event.target.value }));
                  }}
                >
                  <option value="">Sin tipo especificado</option>
                  {VEHICLE_TYPE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

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
                      ? 'Agregar vehículo'
                      : 'Guardar cambios'}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {confirmDelete ? (
        <ConfirmDialog
          open={confirmDelete !== null}
          title={`Eliminar "${confirmDelete.brand} ${confirmDelete.model}"`}
          message="El vehículo será eliminado del catálogo de este estacionamiento. Esta acción es irreversible."
          confirmLabel="Eliminar"
          variant="danger"
          isPending={saving}
          onCancel={() => {
            if (!saving) setConfirmDelete(null);
          }}
          onConfirm={handleConfirmDelete}
        />
      ) : null}
    </section>
  );
}
