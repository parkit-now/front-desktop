import type { ColumnDef } from '@tanstack/react-table';
import { useLiveQuery } from 'dexie-react-hooks';
import { Pencil, Plus, Power, Star, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { DataTable, type DataTableFilterOption } from '../data-table';
import {
  createPaymentMethod,
  deletePaymentMethod,
  togglePaymentMethod,
  type PaymentMethodDto,
} from '../../lib/api/payment-methods';
import { ApiError } from '../../lib/api/client';
import { translateApiError } from '../../lib/api/translate';
import { localDb, type LocalPaymentMethod } from '../../lib/db/localDb';
import { enqueuePendingOp } from '../../lib/sync/enqueue';
import { formatArgentinaDateTime } from '../../lib/format/argentina';
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
  name: string;
};

type FormErrors = {
  name?: string;
};

type PmConfirmAction = {
  kind: 'enable' | 'disable' | 'delete' | 'setDefault';
  pm: PaymentMethodDto;
};

const STATUS_FILTER_OPTIONS: DataTableFilterOption[] = [
  { value: 'Habilitado', label: 'Habilitado' },
  { value: 'Deshabilitado', label: 'Deshabilitado' },
];

function pmStatus(pm: PaymentMethodDto): 'Habilitado' | 'Deshabilitado' {
  return pm.enabled ? 'Habilitado' : 'Deshabilitado';
}

function localToDisplay(r: LocalPaymentMethod): PaymentMethodDto {
  return {
    id: r.id,
    // `?? 'other'` sólo para filas anteriores a la v13 de Dexie, que todavía
    // no bajaron el campo. Es un default de DISPLAY y no toca el arqueo: el
    // arqueo lee el tipo snapshoteado en la transacción, no esto.
    type: r.type ?? 'other',
    name: r.name,
    enabled: r.enabled,
    isDefault: r.isDefault,
    isSystem: r.isSystem ?? false,
    syncSeq: r.syncSeq,
    version: r.version,
    updatedAt: r.updatedAt,
    createdAt: r.createdAt,
  };
}

function apiToLocal(r: PaymentMethodDto, tenantId: string): LocalPaymentMethod {
  return {
    id: r.id,
    tenantId,
    type: r.type,
    name: r.name,
    enabled: r.enabled,
    isDefault: r.isDefault,
    isSystem: r.isSystem,
    syncSeq: r.syncSeq,
    version: r.version,
    updatedAt: r.updatedAt,
    createdAt: r.createdAt,
  };
}

function emptyForm(): FormState {
  return { name: '' };
}

function fromPm(pm: PaymentMethodDto): FormState {
  return { name: pm.name };
}

export function PaymentMethodsPanel({
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
  const [editingPm, setEditingPm] = useState<PaymentMethodDto | null>(null);
  const [confirmAction, setConfirmAction] = useState<PmConfirmAction | null>(
    null,
  );
  const [form, setForm] = useState<FormState>(() => emptyForm());
  const [errors, setErrors] = useState<FormErrors>({});

  const localMethods = useLiveQuery(
    () =>
      localDb.paymentMethods
        .where('tenantId')
        .equals(tenantId)
        .sortBy('createdAt'),
    [tenantId],
  );

  const methods: PaymentMethodDto[] = useMemo(
    () => (localMethods ?? []).map(localToDisplay),
    [localMethods],
  );

  const loading = localMethods === undefined || isSyncing;

  useEffect(() => {
    if (!editorOpen) return;
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape' && !saving) closeEditor();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [editorOpen, saving]);

  const canSubmitForm = useMemo(
    () => form.name.trim().length > 0 && form.name.trim().length <= 120,
    [form.name],
  );

  function resetEditor(): void {
    setEditorMode('create');
    setEditingPm(null);
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

  function beginEdit(pm: PaymentMethodDto): void {
    if (!canManage) return;
    setEditorMode('edit');
    setEditingPm(pm);
    setForm(fromPm(pm));
    setErrors({});
    setEditorOpen(true);
  }

  function validateForm(): { payload?: FormState } {
    const nextErrors: FormErrors = {};
    const name = form.name.trim();
    if (name.length === 0) nextErrors.name = 'El nombre es obligatorio.';
    else if (name.length > 120) nextErrors.name = 'Máximo 120 caracteres.';
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return {};
    return { payload: { name } };
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
        if (isOnline) {
          const result = await createPaymentMethod({
            tenantId,
            bearer: accessToken,
            body: { name: payload.name },
          });
          await localDb.paymentMethods.put(apiToLocal(result, tenantId));
        } else {
          const id = generateUuidV7();
          const now = new Date().toISOString();
          await localDb.transaction(
            'rw',
            localDb.paymentMethods,
            localDb.pendingOps,
            async () => {
              await localDb.paymentMethods.put({
                id,
                tenantId,
                name: payload.name,
                enabled: true,
                isDefault: false,
                isSystem: false,
                syncSeq: 0,
                version: 1,
                updatedAt: now,
                createdAt: now,
              });
              await enqueuePendingOp({
                entityType: 'paymentMethod',
                operation: 'create',
                tenantId,
                entityId: id,
                payload: { name: payload.name },
                status: 'pending',
              });
            },
          );
        }
        showToast({
          message: isOnline
            ? 'Método de pago creado.'
            : 'Método guardado localmente.',
          kind: 'success',
        });
      } else if (editingPm) {
        if (payload.name === editingPm.name) {
          showToast({ message: 'No hay cambios para guardar.', kind: 'info' });
          setSaving(false);
          return;
        }
        if (isOnline) {
          const result = await togglePaymentMethod({
            tenantId,
            bearer: accessToken,
            id: editingPm.id,
            body: { name: payload.name },
          });
          await localDb.paymentMethods.put(apiToLocal(result, tenantId));
        } else {
          await localDb.transaction(
            'rw',
            localDb.paymentMethods,
            localDb.pendingOps,
            async () => {
              await localDb.paymentMethods.update(editingPm.id, {
                name: payload.name,
                updatedAt: new Date().toISOString(),
              });
              await enqueuePendingOp({
                entityType: 'paymentMethod',
                operation: 'update',
                tenantId,
                entityId: editingPm.id,
                payload: { name: payload.name },
                status: 'pending',
              });
            },
          );
        }
        showToast({
          message: isOnline
            ? 'Método actualizado.'
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

  async function handleConfirmAction(): Promise<void> {
    if (!canManage || !confirmAction) return;
    setSaving(true);
    try {
      const pm = confirmAction.pm;
      if (confirmAction.kind === 'enable' || confirmAction.kind === 'disable') {
        const enabled = confirmAction.kind === 'enable';
        if (isOnline) {
          const result = await togglePaymentMethod({
            tenantId,
            bearer: accessToken,
            id: pm.id,
            body: { enabled },
          });
          await localDb.paymentMethods.put(apiToLocal(result, tenantId));
        } else {
          await localDb.transaction(
            'rw',
            localDb.paymentMethods,
            localDb.pendingOps,
            async () => {
              await localDb.paymentMethods.update(pm.id, {
                enabled,
                updatedAt: new Date().toISOString(),
              });
              await enqueuePendingOp({
                entityType: 'paymentMethod',
                operation: 'update',
                tenantId,
                entityId: pm.id,
                payload: { enabled },
                status: 'pending',
              });
            },
          );
        }
        showToast({
          message: isOnline
            ? enabled
              ? 'Método habilitado.'
              : 'Método deshabilitado.'
            : 'Cambio guardado localmente.',
          kind: 'success',
        });
      } else if (confirmAction.kind === 'setDefault') {
        // A single default per tenant: clearing the others keeps the table
        // consistent with the backend invariant before the next sync.
        const clearOthers = async (): Promise<void> => {
          const others = await localDb.paymentMethods
            .where('tenantId')
            .equals(tenantId)
            .filter((m) => m.isDefault && m.id !== pm.id)
            .toArray();
          for (const o of others) {
            await localDb.paymentMethods.update(o.id, { isDefault: false });
          }
        };
        if (isOnline) {
          const result = await togglePaymentMethod({
            tenantId,
            bearer: accessToken,
            id: pm.id,
            body: { isDefault: true },
          });
          await localDb.transaction('rw', localDb.paymentMethods, async () => {
            await clearOthers();
            await localDb.paymentMethods.put(apiToLocal(result, tenantId));
          });
        } else {
          const now = new Date().toISOString();
          await localDb.transaction(
            'rw',
            localDb.paymentMethods,
            localDb.pendingOps,
            async () => {
              await clearOthers();
              await localDb.paymentMethods.update(pm.id, {
                isDefault: true,
                updatedAt: now,
              });
              await enqueuePendingOp({
                entityType: 'paymentMethod',
                operation: 'update',
                tenantId,
                entityId: pm.id,
                payload: { isDefault: true },
                status: 'pending',
              });
            },
          );
        }
        showToast({
          message: isOnline
            ? 'Predeterminado actualizado.'
            : 'Cambio guardado localmente.',
          kind: 'success',
        });
      } else {
        // delete
        if (isOnline) {
          try {
            await deletePaymentMethod({
              tenantId,
              bearer: accessToken,
              id: pm.id,
            });
          } catch (err) {
            // 404 = already gone from server; still clean up locally
            if (!(err instanceof ApiError) || err.status !== 404) throw err;
          }
        } else {
          await enqueuePendingOp({
            entityType: 'paymentMethod',
            operation: 'delete',
            tenantId,
            entityId: pm.id,
            payload: {},
            status: 'pending',
          });
        }
        await localDb.paymentMethods.delete(pm.id);
        showToast({ message: 'Método eliminado.', kind: 'success' });
      }
      setConfirmAction(null);
    } catch (error) {
      showToast({ message: translateApiError(error), kind: 'error' });
    } finally {
      setSaving(false);
    }
  }

  const confirmDialogCopy = confirmAction
    ? confirmAction.kind === 'enable'
      ? {
          title: `Habilitar "${confirmAction.pm.name}"`,
          message: 'El método de pago volverá a estar disponible para operar.',
          confirmLabel: 'Habilitar',
          variant: 'warning' as const,
        }
      : confirmAction.kind === 'disable'
        ? {
            title: `Deshabilitar "${confirmAction.pm.name}"`,
            message:
              'El método quedará oculto en la operación activa. Podés volver a habilitarlo desde la tabla.',
            confirmLabel: 'Deshabilitar',
            variant: 'warning' as const,
          }
        : confirmAction.kind === 'setDefault'
          ? {
              title: `Marcar "${confirmAction.pm.name}" como predeterminado`,
              message:
                'Será el método preseleccionado al cobrar. El predeterminado actual dejará de serlo.',
              confirmLabel: 'Marcar predeterminado',
              variant: 'warning' as const,
            }
          : {
              title: `Eliminar "${confirmAction.pm.name}"`,
              message:
                'Esta acción es permanente e irreversible. El método de pago será eliminado definitivamente.',
              confirmLabel: 'Eliminar',
              variant: 'danger' as const,
            }
    : null;

  const columns = useMemo<ColumnDef<PaymentMethodDto, unknown>[]>(() => {
    const baseColumns: ColumnDef<PaymentMethodDto, unknown>[] = [
      {
        accessorKey: 'name',
        header: 'Nombre',
        size: 280,
        cell: ({ row }) => {
          const pm = row.original;
          return (
            <div className="dt-name-cell">
              <strong>{pm.name}</strong>
              {pm.isSystem ? (
                <span className="status-badge status-muted">Sistema</span>
              ) : null}
              {pm.isDefault ? (
                <span className="status-badge status-ok">Por defecto</span>
              ) : null}
            </div>
          );
        },
      },
      {
        id: 'status',
        header: 'Estado',
        accessorFn: (pm) => pmStatus(pm),
        size: 150,
        cell: ({ row }) => {
          const disabled = pmStatus(row.original) === 'Deshabilitado';
          return (
            <span
              className={`status-badge ${disabled ? 'status-muted' : 'status-ok'}`}
            >
              {disabled ? 'Deshabilitado' : 'Habilitado'}
            </span>
          );
        },
      },
      {
        accessorKey: 'updatedAt',
        header: 'Actualizado',
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
        size: 180,
        cell: ({ row }) => {
          const pm = row.original;
          const disabled = pmStatus(pm) === 'Deshabilitado';
          return (
            <div className="dt-row-actions">
              <button
                type="button"
                className="table-icon-action"
                onClick={() => beginEdit(pm)}
                disabled={saving}
                title="Renombrar"
                aria-label={`Editar ${pm.name}`}
              >
                <Pencil size={16} />
              </button>
              {/* Set as default: only for an enabled, non-default method. */}
              {!pm.isDefault && pm.enabled ? (
                <button
                  type="button"
                  className="table-icon-action"
                  onClick={() => setConfirmAction({ kind: 'setDefault', pm })}
                  disabled={saving}
                  title="Marcar como predeterminado"
                  aria-label={`Marcar ${pm.name} como predeterminado`}
                >
                  <Star size={16} />
                </button>
              ) : null}
              {/* The default stays enabled, so no enable/disable toggle for it. */}
              {!pm.isDefault ? (
                <button
                  type="button"
                  className={`table-icon-action ${disabled ? 'warning' : 'active'}`}
                  onClick={() =>
                    setConfirmAction({
                      kind: disabled ? 'enable' : 'disable',
                      pm,
                    })
                  }
                  disabled={saving}
                  title={disabled ? 'Habilitar método' : 'Deshabilitar método'}
                  aria-label={
                    disabled
                      ? `Habilitar ${pm.name}`
                      : `Deshabilitar ${pm.name}`
                  }
                >
                  <Power size={16} />
                </button>
              ) : null}
              {/* System methods (transfer, cash) can't be deleted. */}
              <button
                type="button"
                className="table-icon-action danger"
                onClick={() => setConfirmAction({ kind: 'delete', pm })}
                disabled={saving || pm.isSystem}
                title={
                  pm.isSystem
                    ? 'Los métodos de sistema no se pueden eliminar'
                    : 'Eliminar método'
                }
                aria-label={
                  pm.isSystem
                    ? `${pm.name} es un método de sistema y no se puede eliminar`
                    : `Eliminar ${pm.name}`
                }
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
            data={methods}
            columns={columns}
            title="Métodos de pago"
            subtitle="Configurá los métodos disponibles para cobrar en el estacionamiento."
            isLoading={loading}
            emptyMessage={
              canManage
                ? 'Creá el primer método de pago para empezar a cobrar.'
                : 'Todavía no hay métodos de pago configurados para este estacionamiento.'
            }
            searchPlaceholder="Buscar por nombre..."
            searchableKeys={['name']}
            filterableColumns={['status']}
            filterOptionsByColumn={{ status: STATUS_FILTER_OPTIONS }}
            getRowId={(pm) => pm.id}
            initialPageSize={10}
            templateScope={{ userId, tenantId, tableKey: 'payment-methods' }}
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
                  Nuevo método
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
            aria-labelledby="pm-dialog-title"
          >
            <header className="rate-dialog-header">
              <div>
                <p className="rate-dialog-kicker">Métodos de pago</p>
                <h3 id="pm-dialog-title">
                  {editorMode === 'create'
                    ? 'Nuevo método de pago'
                    : 'Editar método de pago'}
                </h3>
                <p className="muted">
                  {editorMode === 'create'
                    ? 'Agregá un método personalizado para cobrar en el estacionamiento.'
                    : 'Podés renombrar el método de pago.'}
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
                  placeholder="Nombre (ej. Naranja X)"
                  value={form.name}
                  onChange={(event) => {
                    setForm((prev) => ({ ...prev, name: event.target.value }));
                  }}
                  className={errors.name ? 'input-error' : undefined}
                  autoFocus
                />
                {errors.name ? (
                  <p className="field-error">{errors.name}</p>
                ) : null}
              </div>

              <p className="form-helper">
                {editorMode === 'create'
                  ? 'Los métodos nuevos se crean habilitados. Podés habilitarlos o deshabilitarlos desde la tabla.'
                  : 'Para cambiar el estado del método usá el botón de habilitar/deshabilitar en la tabla.'}
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
                      ? 'Crear método'
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
          onConfirm={handleConfirmAction}
        />
      ) : null}
    </section>
  );
}
