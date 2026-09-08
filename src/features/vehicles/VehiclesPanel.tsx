import type { ColumnDef } from '@tanstack/react-table';
import { useLiveQuery } from 'dexie-react-hooks';
import { Pencil, Plus, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { DataTable } from '../data-table';
import {
  createTenantVehicle,
  updateTenantVehicle,
  deleteTenantVehicle,
} from '../../lib/api/vehicles';
import { ApiError } from '../../lib/api/client';
import { translateApiError } from '../../lib/api/translate';
import { localDb, type LocalVehicle } from '../../lib/db/localDb';
import { enqueuePendingOp } from '../../lib/sync/enqueue';
import { useNetwork } from '../../lib/network/NetworkContext';
import { useToast } from '../../lib/notifications/ToastProvider';
import { useSync } from '../../lib/sync/SyncContext';
import { ConfirmDialog } from '../../lib/ui/ConfirmDialog';
import { AppSelect } from '../../lib/ui/AppSelect';
import { generateUuidV7 } from '../entries/entryUtils';
import { vehicleToLocal } from '../../lib/sync/SyncService';

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
  /** Id del tipo. El tipo es obligatorio: nunca queda un vehículo sin tipo. */
  typeId: string;
};

type FormErrors = {
  brand?: string;
  model?: string;
  typeId?: string;
};

type VehicleRow = {
  id: string;
  brand: string;
  model: string;
  typeId: string;
  version: number;
  syncSeq: number;
  updatedAt: string;
  createdAt: string;
};

function localToRow(v: LocalVehicle): VehicleRow {
  return {
    id: v.id,
    brand: v.brand,
    model: v.model,
    typeId: v.typeId,
    version: v.version,
    syncSeq: v.syncSeq,
    updatedAt: v.updatedAt,
    createdAt: v.createdAt,
  };
}

function emptyForm(): FormState {
  return { brand: '', model: '', typeId: '' };
}

function fromRow(v: VehicleRow): FormState {
  return { brand: v.brand, model: v.model, typeId: v.typeId };
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

  // `.where()` indexado en vez de un scan de tabla completa. Y se cae el
  // `!v.tenantId ||` que dejaba pasar los globales: ya no existen.
  const localVehicles = useLiveQuery(
    () =>
      localDb.vehicles
        .where('tenantId')
        .equals(tenantId)
        .filter((v) => !v.deletedAt)
        .toArray(),
    [tenantId],
  );

  const localTypes = useLiveQuery(
    () =>
      localDb.vehicleTypes
        .where('tenantId')
        .equals(tenantId)
        .filter((t) => !t.deletedAt)
        .toArray(),
    [tenantId],
  );

  const typeOptions = useMemo(
    () =>
      (localTypes ?? [])
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name, 'es'))
        .map((t) => ({ value: t.id, label: t.name })),
    [localTypes],
  );

  const typeNameById = useMemo(
    () => new Map((localTypes ?? []).map((t) => [t.id, t.name])),
    [localTypes],
  );

  const vehicles: VehicleRow[] = useMemo(
    () => (localVehicles ?? []).map(localToRow),
    [localVehicles],
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
    if (!canManage) return;
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
    // Obligatorio: borrar un tipo fuerza a reasignar, así que un vehículo nunca
    // queda sin tipo. "Otro" es el balde para lo que no encaja.
    if (form.typeId === '') nextErrors.typeId = 'Elegí un tipo de vehículo.';
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return {};
    return { payload: { brand, model, typeId: form.typeId } };
  }

  /**
   * El optimistic locking del backend responde 409 cuando la `version` que
   * mandamos quedó vieja. No se reintenta solo: reintentar pisaría el cambio de
   * la otra persona, que es justo lo que el control de versión evita.
   *
   * Se cierra el editor y el diálogo porque los dos guardan una foto de la fila
   * (id + version); si quedaran abiertos, el próximo intento repetiría la
   * versión vieja y volvería a chocar en loop.
   */
  function handleApiError(error: unknown): void {
    if (error instanceof ApiError && error.status === 409) {
      setEditorOpen(false);
      resetEditor();
      setConfirmDelete(null);
      if (isOnline) void triggerSync();
      showToast({
        message:
          'El vehículo fue modificado por otra persona. Actualizamos el catálogo, revisá los datos y volvé a intentar.',
        kind: 'error',
      });
      return;
    }
    showToast({ message: translateApiError(error), kind: 'error' });
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
        if (isOnline) {
          const result = await createTenantVehicle({
            tenantId,
            bearer: accessToken,
            body: {
              id,
              brand: payload.brand,
              model: payload.model,
              typeId: payload.typeId,
            },
          });
          await localDb.vehicles.put(vehicleToLocal(result));
        } else {
          await localDb.transaction(
            'rw',
            [localDb.vehicles, localDb.pendingOps],
            async () => {
              await localDb.vehicles.put({
                id,
                brand: payload.brand,
                model: payload.model,
                typeId: payload.typeId,
                tenantId,
                // Provisoria: el servidor asigna la real cuando la op se sube.
                version: 1,
                syncSeq: 0,
                updatedAt: now,
                createdAt: now,
              });
              await enqueuePendingOp({
                entityType: 'vehicle',
                operation: 'create',
                tenantId,
                entityId: id,
                payload: {
                  id,
                  brand: payload.brand,
                  model: payload.model,
                  typeId: payload.typeId,
                },
                status: 'pending',
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
          payload.typeId !== editingVehicle.typeId;
        if (!changed) {
          showToast({ message: 'No hay cambios para guardar.', kind: 'info' });
          setSaving(false);
          return;
        }
        if (isOnline) {
          const result = await updateTenantVehicle({
            tenantId,
            bearer: accessToken,
            vehicleId: editingVehicle.id,
            expectedVersion: editingVehicle.version,
            body: {
              brand: payload.brand,
              model: payload.model,
              typeId: payload.typeId,
            },
          });
          await localDb.vehicles.update(editingVehicle.id, {
            brand: result.brand,
            model: result.model,
            typeId: result.typeId,
            version: result.version,
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
                typeId: payload.typeId,
                updatedAt: now,
              });
              await enqueuePendingOp({
                entityType: 'vehicle',
                operation: 'update',
                tenantId,
                entityId: editingVehicle.id,
                // `expectedVersion` va junto al body: el backend lo exige y sin
                // él la op vuelve con 400 al reconectar.
                payload: {
                  expectedVersion: editingVehicle.version,
                  body: {
                    brand: payload.brand,
                    model: payload.model,
                    typeId: payload.typeId,
                  },
                },
                status: 'pending',
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
      handleApiError(error);
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
          vehicleId: confirmDelete.id,
          expectedVersion: confirmDelete.version,
        });
        await localDb.vehicles.delete(confirmDelete.id);
      } else {
        // En una transacción, igual que create y update: si el borrado local
        // fallaba, la op quedaba encolada igual y el vehículo seguía visible.
        await localDb.transaction(
          'rw',
          [localDb.vehicles, localDb.pendingOps],
          async () => {
            await enqueuePendingOp({
              entityType: 'vehicle',
              operation: 'delete',
              tenantId,
              entityId: confirmDelete.id,
              payload: { expectedVersion: confirmDelete.version },
              status: 'pending',
            });
            await localDb.vehicles.delete(confirmDelete.id);
          },
        );
      }
      showToast({
        message: isOnline ? 'Vehículo eliminado.' : 'Baja guardada localmente.',
        kind: 'success',
      });
      setConfirmDelete(null);
    } catch (error) {
      handleApiError(error);
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
        // Un typeId irresoluble significa que la etapa de tipos del sync no
        // llegó todavía (o falló). Mejor un guion que un uuid crudo.
        accessorFn: (v) => typeNameById.get(v.typeId) ?? '—',
        size: 140,
        cell: ({ row }) => typeNameById.get(row.original.typeId) ?? '—',
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
  }, [canManage, saving, typeNameById]);

  return (
    <section className="rates-panel">
      <div className="rates-layout readonly">
        <div className="rates-table-card data-table-host">
          <DataTable
            data={vehicles}
            columns={columns}
            title="Catálogo de vehículos"
            subtitle="Los vehículos que este estacionamiento puede registrar."
            isLoading={loading}
            emptyMessage={
              canManage
                ? 'No hay vehículos en el catálogo. Agregá el primero.'
                : 'No hay vehículos en el catálogo todavía.'
            }
            searchPlaceholder="Buscar por marca o modelo..."
            searchableKeys={['brand', 'model']}
            filterableColumns={['type']}
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
                <label className="field-label" htmlFor="vehicle-type">
                  Tipo
                </label>
                <AppSelect
                  id="vehicle-type"
                  value={form.typeId}
                  onChange={(value) =>
                    setForm((prev) => ({ ...prev, typeId: value }))
                  }
                  placeholder={
                    typeOptions.length === 0
                      ? 'No hay tipos configurados'
                      : 'Elegí un tipo'
                  }
                  options={typeOptions}
                  error={Boolean(errors.typeId)}
                  disabled={saving || typeOptions.length === 0}
                />
                {errors.typeId ? (
                  <p className="field-error">{errors.typeId}</p>
                ) : null}
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
