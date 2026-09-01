import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Pencil, Trash2 } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';
import { DataTable } from '../data-table';
import { localDb, type LocalVehicleType } from '../../lib/db/localDb';
import { ApiError } from '../../lib/api/client';
import { translateApiError } from '../../lib/api/translate';
import {
  createVehicleType,
  deleteVehicleType,
  updateVehicleType,
} from '../../lib/api/vehicle-types';
import { useToast } from '../../lib/notifications/ToastProvider';
import { useNetwork } from '../../lib/network/NetworkContext';
import { useSync } from '../../lib/sync/SyncContext';
import { ConfirmDialog } from '../../lib/ui/ConfirmDialog';
import { AppSelect } from '../../lib/ui/AppSelect';
import { vehicleTypeToLocal } from '../../lib/sync/SyncService';
import { generateUuidV7 } from '../entries/entryUtils';

type Props = {
  accessToken: string;
  tenantId: string;
  canManage: boolean;
};

type TypeRow = {
  id: string;
  name: string;
  accepted: boolean;
  version: number;
  vehicleCount: number;
};

const NAME_MAX_LENGTH = 60;

function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

export function VehicleTypesPanel({ accessToken, tenantId, canManage }: Props) {
  const { showToast } = useToast();
  const { isOnline } = useNetwork();
  const { triggerSync } = useSync();

  const [saving, setSaving] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<TypeRow | null>(null);
  const [name, setName] = useState('');
  const [accepted, setAccepted] = useState(true);
  const [nameError, setNameError] = useState<string | undefined>(undefined);

  const [confirmDelete, setConfirmDelete] = useState<TypeRow | null>(null);
  const [reassignTarget, setReassignTarget] = useState('');

  const localTypes = useLiveQuery(
    () =>
      localDb.vehicleTypes
        .where('tenantId')
        .equals(tenantId)
        .filter((t) => !t.deletedAt)
        .toArray(),
    [tenantId],
  );

  const localVehicles = useLiveQuery(
    () =>
      localDb.vehicles
        .where('tenantId')
        .equals(tenantId)
        .filter((v) => !v.deletedAt)
        .toArray(),
    [tenantId],
  );

  const countByType = useMemo(() => {
    const counts = new Map<string, number>();
    for (const v of localVehicles ?? []) {
      counts.set(v.typeId, (counts.get(v.typeId) ?? 0) + 1);
    }
    return counts;
  }, [localVehicles]);

  const types: TypeRow[] = useMemo(
    () =>
      (localTypes ?? [])
        .map((t: LocalVehicleType) => ({
          id: t.id,
          name: t.name,
          accepted: t.accepted,
          version: t.version,
          vehicleCount: countByType.get(t.id) ?? 0,
        }))
        .sort((a, b) => a.name.localeCompare(b.name, 'es')),
    [localTypes, countByType],
  );

  /** Los destinos posibles para la reasignación, sin el que se borra. */
  const reassignOptions = useMemo(
    () =>
      types
        .filter((t) => t.id !== confirmDelete?.id)
        .map((t) => ({ value: t.id, label: t.name })),
    [types, confirmDelete],
  );

  const inUse = (confirmDelete?.vehicleCount ?? 0) > 0;

  /**
   * Copiado de `VehiclesPanel.handleApiError` —el único manejo explícito de 409
   * del desktop— con una diferencia: acá hay TRES 409 y el de optimistic
   * locking no tiene código propio, así que hay que ramificar por
   * `problem.code` antes que por status.
   */
  function handleApiError(error: unknown): void {
    const code =
      error instanceof ApiError
        ? (error.problem as { code?: string } | null)?.code
        : undefined;

    if (code === 'VEHICLE_TYPE_DUPLICATE') {
      // El único 409 que NO cierra el editor: el error va abajo del input.
      setNameError('Ya tenés un tipo con ese nombre.');
      return;
    }

    if (error instanceof ApiError && error.status === 409) {
      setEditorOpen(false);
      setEditing(null);
      setConfirmDelete(null);
      if (isOnline) void triggerSync();
      showToast({
        message:
          code === 'VEHICLE_TYPE_IN_USE'
            ? 'Alguien asignó un vehículo a este tipo. Actualizamos la lista, volvé a intentar el borrado.'
            : 'El tipo fue modificado por otra persona. Actualizamos la lista, revisá los datos y volvé a intentar.',
        kind: 'error',
      });
      return;
    }
    showToast({ message: translateApiError(error), kind: 'error' });
  }

  function beginCreate(): void {
    if (!canManage) return;
    setEditing(null);
    setName('');
    setAccepted(true);
    setNameError(undefined);
    setEditorOpen(true);
  }

  function beginEdit(t: TypeRow): void {
    if (!canManage) return;
    setEditing(t);
    setName(t.name);
    setAccepted(t.accepted);
    setNameError(undefined);
    setEditorOpen(true);
  }

  async function handleSubmit(
    event: React.FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    if (!canManage) return;

    const clean = normalizeName(name);
    if (clean.length === 0) {
      setNameError('El nombre es obligatorio.');
      return;
    }
    if (clean.length > NAME_MAX_LENGTH) {
      setNameError('Máximo 60 caracteres.');
      return;
    }
    const clash = types.find(
      (t) =>
        t.id !== editing?.id &&
        normalizeName(t.name).toLowerCase() === clean.toLowerCase(),
    );
    if (clash) {
      setNameError('Ya tenés un tipo con ese nombre.');
      return;
    }

    setSaving(true);
    try {
      const now = new Date().toISOString();
      if (!editing) {
        const id = generateUuidV7();
        if (isOnline) {
          const result = await createVehicleType({
            tenantId,
            bearer: accessToken,
            body: { id, name: clean, accepted },
          });
          await localDb.vehicleTypes.put(vehicleTypeToLocal(result));
        } else {
          await localDb.transaction(
            'rw',
            [localDb.vehicleTypes, localDb.pendingOps],
            async () => {
              await localDb.vehicleTypes.put({
                id,
                tenantId,
                name: clean,
                accepted,
                // Provisoria: el servidor asigna la real al subir la op.
                version: 1,
                syncSeq: 0,
                updatedAt: now,
                createdAt: now,
              });
              await localDb.pendingOps.add({
                entityType: 'vehicleType',
                operation: 'create',
                tenantId,
                entityId: id,
                payload: { id, name: clean, accepted },
                status: 'pending',
                createdAt: Date.now(),
                retryCount: 0,
              });
            },
          );
        }
        showToast({
          message: isOnline
            ? 'Tipo de vehículo creado.'
            : 'Tipo guardado localmente.',
          kind: 'success',
        });
      } else {
        if (clean === editing.name && accepted === editing.accepted) {
          showToast({ message: 'No hay cambios para guardar.', kind: 'info' });
          setSaving(false);
          return;
        }
        const body = { name: clean, accepted };
        if (isOnline) {
          const result = await updateVehicleType({
            tenantId,
            bearer: accessToken,
            typeId: editing.id,
            expectedVersion: editing.version,
            body,
          });
          await localDb.vehicleTypes.put(vehicleTypeToLocal(result));
        } else {
          await localDb.transaction(
            'rw',
            [localDb.vehicleTypes, localDb.pendingOps],
            async () => {
              await localDb.vehicleTypes.update(editing.id, {
                name: clean,
                accepted,
                updatedAt: now,
              });
              await localDb.pendingOps.add({
                entityType: 'vehicleType',
                operation: 'update',
                tenantId,
                entityId: editing.id,
                payload: { expectedVersion: editing.version, body },
                status: 'pending',
                createdAt: Date.now(),
                retryCount: 0,
              });
            },
          );
        }
        showToast({
          message: isOnline
            ? 'Tipo actualizado.'
            : 'Cambio guardado localmente.',
          kind: 'success',
        });
      }
      setEditorOpen(false);
      setEditing(null);
    } catch (error) {
      handleApiError(error);
    } finally {
      setSaving(false);
    }
  }

  async function handleConfirmDelete(): Promise<void> {
    if (!canManage || !confirmDelete) return;
    if (inUse && !reassignTarget) return;

    setSaving(true);
    try {
      const result = await deleteVehicleType({
        tenantId,
        bearer: accessToken,
        typeId: confirmDelete.id,
        expectedVersion: confirmDelete.version,
        reassignToTypeId: inUse ? reassignTarget : undefined,
      });
      await localDb.vehicleTypes.delete(confirmDelete.id);
      // Los N vehículos reasignados cambiaron de `syncSeq` server-side: el pull
      // los trae con el `typeId` nuevo.
      if (result.reassignedVehicles > 0) void triggerSync();
      setConfirmDelete(null);
      setReassignTarget('');
      showToast({
        message:
          result.reassignedVehicles > 0
            ? `Tipo eliminado. Movimos ${result.reassignedVehicles} vehículo(s).`
            : 'Tipo eliminado.',
        kind: 'success',
      });
    } catch (error) {
      handleApiError(error);
    } finally {
      setSaving(false);
    }
  }

  const columns = useMemo<ColumnDef<TypeRow>[]>(() => {
    const base: ColumnDef<TypeRow>[] = [
      {
        accessorKey: 'name',
        header: 'Nombre',
        size: 200,
        cell: ({ row }) => row.original.name,
      },
      {
        id: 'accepted',
        header: 'Aceptado',
        accessorFn: (t) => (t.accepted ? 'Sí' : 'No'),
        size: 120,
        cell: ({ row }) => (
          <span
            className={`status-badge ${row.original.accepted ? 'status-ok' : 'status-muted'}`}
          >
            {row.original.accepted ? 'Sí' : 'No'}
          </span>
        ),
      },
      {
        accessorKey: 'vehicleCount',
        header: 'En uso',
        size: 110,
        cell: ({ row }) => `${row.original.vehicleCount} vehículo(s)`,
      },
    ];

    if (!canManage) return base;

    return [
      ...base,
      {
        id: 'actions',
        header: 'Acciones',
        enableHiding: false,
        enableSorting: false,
        size: 120,
        cell: ({ row }) => {
          const t = row.original;
          // Borrar un tipo EN USO son dos llamadas dependientes con un bulk
          // update del lado del servidor: su modo de falla offline es una
          // divergencia silenciosa entre los typeId locales y los del backend.
          // Altas, renombres y borrados simples sí funcionan sin conexión.
          const deleteBlocked = t.vehicleCount > 0 && !isOnline;
          return (
            <div className="dt-row-actions">
              <button
                type="button"
                className="table-icon-action"
                onClick={() => beginEdit(t)}
                disabled={saving}
                title="Editar"
                aria-label={`Editar ${t.name}`}
              >
                <Pencil size={16} />
              </button>
              <button
                type="button"
                className="table-icon-action danger"
                onClick={() => {
                  setReassignTarget('');
                  setConfirmDelete(t);
                }}
                disabled={saving || deleteBlocked}
                title={
                  deleteBlocked
                    ? 'Necesitás conexión para reasignar los vehículos de este tipo'
                    : 'Eliminar'
                }
                aria-label={`Eliminar ${t.name}`}
              >
                <Trash2 size={16} />
              </button>
            </div>
          );
        },
      },
    ];
  }, [canManage, saving, isOnline]);

  return (
    <section className="rates-panel">
      <div className="rates-layout readonly">
        <div className="rates-table-card data-table-host">
          <DataTable
            data={types}
            columns={columns}
            title="Tipos de vehículo"
            subtitle="Las categorías con las que este estacionamiento clasifica su catálogo."
            isLoading={localTypes === undefined}
            emptyMessage={
              canManage
                ? 'No hay tipos configurados. Creá el primero.'
                : 'No hay tipos configurados todavía.'
            }
            searchPlaceholder="Buscar por nombre..."
            searchableKeys={['name']}
            filterableColumns={['accepted']}
            getRowId={(t) => t.id}
            initialPageSize={10}
            headerAction={
              canManage ? (
                <button
                  type="button"
                  className="primary-button compact"
                  onClick={beginCreate}
                  disabled={saving}
                >
                  Nuevo tipo
                </button>
              ) : null
            }
          />
        </div>
      </div>

      {editorOpen ? (
        <div className="rate-dialog-backdrop">
          <form className="rate-dialog" onSubmit={(e) => void handleSubmit(e)}>
            <h3>
              {editing ? 'Editar tipo de vehículo' : 'Nuevo tipo de vehículo'}
            </h3>

            <div className="form-field">
              <label className="field-label" htmlFor="vehicle-type-name">
                Nombre
              </label>
              <input
                id="vehicle-type-name"
                className={nameError ? 'input-error' : undefined}
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (nameError) setNameError(undefined);
                }}
                placeholder="Ej. Utilitario"
                maxLength={NAME_MAX_LENGTH}
                autoFocus
                disabled={saving}
              />
              {nameError ? <p className="field-error">{nameError}</p> : null}
            </div>

            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={accepted}
                disabled={saving}
                onChange={(e) => setAccepted(e.target.checked)}
              />
              El estacionamiento acepta este tipo de vehículo
            </label>

            <div className="rate-dialog-actions">
              <button
                type="button"
                className="ghost-button"
                onClick={() => {
                  setEditorOpen(false);
                  setEditing(null);
                }}
                disabled={saving}
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="primary-button compact"
                disabled={saving}
              >
                {saving ? 'Guardando...' : 'Guardar'}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {/* Borrado SIMPLE (0 vehículos): alcanza el ConfirmDialog compartido. */}
      <ConfirmDialog
        open={confirmDelete !== null && !inUse}
        title="Eliminar tipo de vehículo"
        message={
          confirmDelete
            ? `¿Eliminar "${confirmDelete.name}"? No hay vehículos usándolo.`
            : ''
        }
        confirmLabel="Eliminar"
        variant="danger"
        isPending={saving}
        onCancel={() => {
          if (!saving) setConfirmDelete(null);
        }}
        onConfirm={() => void handleConfirmDelete()}
      />

      {/* Borrado CON REASIGNACIÓN: diálogo propio, porque `ConfirmDialog` sólo
          acepta un `message: string` y acá hace falta un selector. */}
      {confirmDelete !== null && inUse ? (
        <div className="rate-dialog-backdrop">
          <div className="rate-dialog">
            <h3>Eliminar &quot;{confirmDelete.name}&quot;</h3>
            <p>
              {confirmDelete.vehicleCount === 1
                ? '1 vehículo usa este tipo.'
                : `${confirmDelete.vehicleCount} vehículos usan este tipo.`}{' '}
              Elegí a cuál moverlos antes de eliminarlo.
            </p>

            <div className="form-field">
              <label className="field-label" htmlFor="reassign-target">
                Mover los vehículos a
              </label>
              {/* Sin preselección: un Enter accidental no debe mandar N
                  vehículos al primer tipo de la lista. */}
              <AppSelect
                id="reassign-target"
                value={reassignTarget}
                onChange={setReassignTarget}
                placeholder="Elegí un tipo"
                options={reassignOptions}
                disabled={saving}
              />
            </div>

            <div className="rate-dialog-actions">
              <button
                type="button"
                className="ghost-button"
                onClick={() => {
                  if (!saving) {
                    setConfirmDelete(null);
                    setReassignTarget('');
                  }
                }}
                disabled={saving}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="primary-button compact danger"
                onClick={() => void handleConfirmDelete()}
                disabled={saving || reassignTarget === ''}
              >
                {saving ? 'Eliminando...' : 'Eliminar y reasignar'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
