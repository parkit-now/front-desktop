import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Pencil, Plus, Power, Trash2, X } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';
import { DataTable } from '../data-table';
import { localDb, type LocalLprIgnoredPlate } from '../../lib/db/localDb';
import { useNetwork } from '../../lib/network/NetworkContext';
import { useSync } from '../../lib/sync/SyncContext';
import { useToast } from '../../lib/notifications/ToastProvider';
import { translateApiError } from '../../lib/api/translate';
import { ConfirmDialog } from '../../lib/ui/ConfirmDialog';
import { useEscapeKey } from '../../lib/ui/useEscapeKey';
import {
  ignoredPlateState,
  normalizeIgnoredPlate,
  whitelistDateLabel,
  whitelistFormError,
} from './whitelistUtils';
import { mutateWhitelist } from './whitelistMutations';
import type { UpdateLprIgnoredPlateDto } from '../../lib/api/lpr-ignored-plates';

type Props = {
  tenantId: string;
  accessToken: string;
  userId: string;
  canManage: boolean;
};
const emptyForm = {
  plate: '',
  notes: '',
  active: true,
  validFrom: '',
  validUntil: '',
};

export function LprWhitelistPanel({
  tenantId,
  accessToken,
  userId,
  canManage,
}: Props) {
  const { isOnline } = useNetwork();
  const { triggerSync } = useSync();
  const { showToast } = useToast();
  const rows = useLiveQuery(
    () =>
      localDb.lprIgnoredPlates
        .where('tenantId')
        .equals(tenantId)
        .filter((row) => !row.deletedAt)
        .toArray(),
    [tenantId],
  );
  const [now, setNow] = useState(Date.now);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<LocalLprIgnoredPlate | null>(null);
  const [confirmation, setConfirmation] = useState<{
    row: LocalLprIgnoredPlate;
    kind: 'delete' | 'activate' | 'deactivate';
  } | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const confirmationLabel =
    confirmation?.kind === 'delete'
      ? 'Eliminar'
      : confirmation?.kind === 'activate'
        ? 'Reactivar'
        : 'Desactivar';
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEscapeKey(() => setOpen(false), !saving, open);

  const save = useCallback(
    async function save(
      row: LocalLprIgnoredPlate | undefined,
      body?: UpdateLprIgnoredPlateDto,
      remove = false,
    ) {
      if (!canManage || saving) return;
      setSaving(true);
      try {
        await mutateWhitelist({
          tenantId,
          bearer: accessToken,
          isOnline,
          row,
          body,
          remove,
        });
        setOpen(false);
        setConfirmation(null);
        if (isOnline) void triggerSync();
      } catch (caught) {
        showToast({ message: translateApiError(caught), kind: 'error' });
      } finally {
        setSaving(false);
      }
    },
    [
      canManage,
      saving,
      tenantId,
      accessToken,
      isOnline,
      triggerSync,
      showToast,
    ],
  );

  const begin = useCallback(function begin(row?: LocalLprIgnoredPlate) {
    setEditing(row ?? null);
    setForm(
      row
        ? {
            plate: row.plate,
            notes: row.notes ?? '',
            active: row.active,
            validFrom: row.validFrom ?? '',
            validUntil: row.validUntil ?? '',
          }
        : emptyForm,
    );
    setError(null);
    setOpen(true);
  }, []);

  const columns = useMemo<ColumnDef<LocalLprIgnoredPlate>[]>(
    () => [
      {
        accessorKey: 'plate',
        header: 'Patente',
        cell: (info) => <strong>{String(info.getValue())}</strong>,
      },
      {
        accessorKey: 'notes',
        header: 'Nota',
        cell: ({ row }) => (
          <span className="whitelist-note">{row.original.notes || '—'}</span>
        ),
      },
      {
        id: 'active',
        accessorFn: (row) => (row.active ? 'Sí' : 'No'),
        header: 'Activo',
        cell: ({ row }) => (
          <span
            className={`status-badge ${row.original.active ? 'status-ok' : 'status-muted'}`}
          >
            {row.original.active ? 'Activa' : 'Inactiva'}
          </span>
        ),
      },
      {
        id: 'state',
        accessorFn: (row) => ignoredPlateState(row, now),
        header: 'Estado',
      },
      {
        accessorKey: 'validFrom',
        header: 'Desde',
        filterFn: 'dateRange',
        cell: (info) => whitelistDateLabel(info.getValue() as string | null),
      },
      {
        accessorKey: 'validUntil',
        header: 'Hasta',
        filterFn: 'dateRange',
        cell: (info) => whitelistDateLabel(info.getValue() as string | null),
      },
      {
        id: 'actions',
        header: 'Acciones',
        enableSorting: false,
        cell: ({ row }) =>
          canManage ? (
            <div className="dt-row-actions">
              <button
                type="button"
                className="table-icon-action"
                title="Editar patente"
                aria-label={`Editar ${row.original.plate}`}
                disabled={saving}
                onClick={() => begin(row.original)}
              >
                <Pencil size={16} />
              </button>
              <button
                type="button"
                className={`table-icon-action ${row.original.active ? 'active' : 'warning'}`}
                title={
                  row.original.active
                    ? 'Desactivar patente'
                    : 'Reactivar patente'
                }
                aria-label={`${row.original.active ? 'Desactivar' : 'Reactivar'} ${row.original.plate}`}
                disabled={saving}
                onClick={() =>
                  setConfirmation({
                    row: row.original,
                    kind: row.original.active ? 'deactivate' : 'activate',
                  })
                }
              >
                <Power size={16} />
              </button>
              <button
                type="button"
                className="table-icon-action danger"
                title="Eliminar patente"
                aria-label={`Eliminar ${row.original.plate}`}
                disabled={saving}
                onClick={() =>
                  setConfirmation({ row: row.original, kind: 'delete' })
                }
              >
                <Trash2 size={16} />
              </button>
            </div>
          ) : null,
      },
    ],
    [now, saving, canManage, save, begin],
  );

  if (!canManage) return null;
  return (
    <section className="rates-panel">
      <div className="rates-layout readonly">
        <div className="rates-table-card data-table-host">
          <DataTable
            data={rows ?? []}
            columns={columns}
            title="Lista blanca"
            isLoading={rows === undefined}
            emptyMessage="No hay patentes en la lista blanca."
            searchPlaceholder="Buscar por patente o nota..."
            searchableKeys={['plate', 'notes']}
            filterableColumns={['active', 'state', 'validFrom', 'validUntil']}
            getRowId={(row) => row.id}
            initialPageSize={10}
            initialSorting={[{ id: 'plate', desc: false }]}
            templateScope={{ tenantId, userId, tableKey: 'lpr-whitelist' }}
            onRefresh={() => void triggerSync()}
            refreshDisabled={!isOnline || saving}
            headerAction={
              <button
                type="button"
                className="primary-button compact rates-new-button"
                disabled={saving}
                onClick={() => begin()}
              >
                <Plus size={17} />
                Agregar patente
              </button>
            }
          />
        </div>
      </div>
      {open ? (
        <div className="rate-dialog-backdrop">
          <form
            className="rate-dialog whitelist-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="whitelist-title"
            onSubmit={(event) => {
              event.preventDefault();
              const body = {
                plate: normalizeIgnoredPlate(form.plate),
                notes: form.notes.trim() || null,
                active: form.active,
                validFrom: form.validFrom || null,
                validUntil: form.validUntil || null,
              };
              const validation = whitelistFormError(body);
              const duplicate = rows?.some(
                (row) => row.id !== editing?.id && row.plate === body.plate,
              );
              setError(
                validation ??
                  (duplicate
                    ? 'Esta patente ya está en la lista blanca.'
                    : null),
              );
              if (!validation && !duplicate)
                void save(editing ?? undefined, body);
            }}
          >
            <header className="rate-dialog-header">
              <h3 id="whitelist-title">
                {editing ? 'Editar patente' : 'Agregar patente'}
              </h3>
              <button
                type="button"
                className="rate-dialog-close"
                aria-label="Cerrar"
                title="Cerrar"
                disabled={saving}
                onClick={() => setOpen(false)}
              >
                <X size={18} />
              </button>
            </header>
            <div className="form-field">
              <label className="field-label" htmlFor="whitelist-plate">
                Patente
              </label>
              <input
                id="whitelist-plate"
                value={form.plate}
                maxLength={30}
                autoFocus
                disabled={saving}
                onChange={(event) =>
                  setForm({ ...form, plate: event.target.value })
                }
              />
            </div>
            <div className="form-field">
              <label className="field-label" htmlFor="whitelist-note">
                Nota (opcional)
              </label>
              <textarea
                id="whitelist-note"
                value={form.notes}
                maxLength={500}
                disabled={saving}
                onChange={(event) =>
                  setForm({ ...form, notes: event.target.value })
                }
              />
            </div>
            <div className="whitelist-dates">
              {(['validFrom', 'validUntil'] as const).map((key) => (
                <div className="form-field" key={key}>
                  <label className="field-label" htmlFor={`whitelist-${key}`}>
                    {key === 'validFrom'
                      ? 'Desde (opcional)'
                      : 'Hasta (opcional)'}
                  </label>
                  <input
                    id={`whitelist-${key}`}
                    type="date"
                    value={form[key]}
                    disabled={saving}
                    onChange={(event) =>
                      setForm({ ...form, [key]: event.target.value })
                    }
                  />
                </div>
              ))}
            </div>
            <label className="rate-dialog-checkbox">
              <input
                type="checkbox"
                checked={form.active}
                disabled={saving}
                onChange={(event) =>
                  setForm({ ...form, active: event.target.checked })
                }
              />
              <span>Activo</span>
            </label>
            {error ? (
              <p className="field-error" role="alert">
                {error}
              </p>
            ) : null}
            <div className="rate-dialog-actions">
              <button
                type="button"
                className="ghost-button"
                disabled={saving}
                onClick={() => setOpen(false)}
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="primary-button"
                disabled={saving}
              >
                {saving ? 'Guardando...' : 'Guardar'}
              </button>
            </div>
          </form>
        </div>
      ) : null}
      <ConfirmDialog
        open={Boolean(confirmation)}
        title={`${confirmationLabel} patente`}
        message={`¿${confirmationLabel} ${confirmation?.row.plate ?? ''} ${confirmation?.kind === 'delete' ? 'de' : 'en'} la lista blanca?`}
        confirmLabel={confirmationLabel}
        variant={confirmation?.kind === 'delete' ? 'danger' : 'default'}
        isPending={saving}
        onCancel={() => setConfirmation(null)}
        onConfirm={() => {
          if (!confirmation) return;
          return confirmation.kind === 'delete'
            ? save(confirmation.row, undefined, true)
            : save(confirmation.row, {
                active: confirmation.kind === 'activate',
              });
        }}
      />
    </section>
  );
}
