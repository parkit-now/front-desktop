import { useCallback, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { ColumnDef } from '@tanstack/react-table';
import { Pencil, Plus, Trash2, X } from 'lucide-react';
import { DataTable } from '../data-table';
import { PlateCell } from '../data-table/components/PlateCell';
import { localDb, type LocalClient } from '../../lib/db/localDb';
import { useNetwork } from '../../lib/network/NetworkContext';
import { useSync } from '../../lib/sync/SyncContext';
import { useToast } from '../../lib/notifications/ToastProvider';
import { translateApiError } from '../../lib/api/translate';
import { ConfirmDialog } from '../../lib/ui/ConfirmDialog';
import { normalizeClientPlate } from './clientUtils';
import { mutateClient } from './clientMutations';
import { lookupTaxpayer } from '../../lib/api/arca';
import { isValidCuit } from '../entries/invoiceUtils';
import './clients.css';

type Props = { tenantId: string; accessToken: string; userId: string };
type Form = {
  plates: string[];
  cuit: string;
  name: string;
  nameAutomatic: boolean;
  email: string;
  phone: string;
};
const emptyForm: Form = {
  plates: [''],
  cuit: '',
  name: '',
  nameAutomatic: false,
  email: '',
  phone: '',
};
const dateLabel = (date: string) =>
  new Intl.DateTimeFormat('es-AR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(date));

export function ClientsPanel({ tenantId, accessToken, userId }: Props) {
  const { isOnline } = useNetwork();
  const { triggerSync } = useSync();
  const { showToast } = useToast();
  const rows = useLiveQuery(
    () =>
      localDb.clients
        .where('tenantId')
        .equals(tenantId)
        .filter((row) => !row.deletedAt)
        .toArray(),
    [tenantId],
  );
  const [editing, setEditing] = useState<LocalClient | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Form>(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [moving, setMoving] = useState<string[] | null>(null);
  const [deleting, setDeleting] = useState<LocalClient | null>(null);

  const begin = useCallback((row?: LocalClient) => {
    setEditing(row ?? null);
    setForm(
      row
        ? {
            plates: row.plates,
            cuit: row.cuit ?? '',
            name: row.name ?? '',
            nameAutomatic: false,
            email: row.email ?? '',
            phone: row.phone ?? '',
          }
        : emptyForm,
    );
    setError(null);
    setOpen(true);
  }, []);

  const save = useCallback(
    async (movePlates = false) => {
      if (busy) return;
      const plates = form.plates.map(normalizeClientPlate).filter(Boolean);
      if (
        !plates.length ||
        plates.some((plate) => !/^[A-Z0-9]{1,20}$/.test(plate)) ||
        new Set(plates).size !== plates.length
      ) {
        setError('Ingresá una o más patentes válidas, sin repetir.');
        return;
      }
      const cuit = form.cuit.replace(/\D/g, '');
      if (cuit && !isValidCuit(cuit)) {
        setError('Ingresá un CUIT válido.');
        return;
      }
      if (
        form.email.trim() &&
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())
      ) {
        setError('Ingresá un email válido.');
        return;
      }
      const occupied =
        rows
          ?.filter(
            (row) =>
              row.id !== editing?.id &&
              row.plates.some((plate) => plates.includes(plate)),
          )
          .flatMap((row) =>
            row.plates.filter((plate) => plates.includes(plate)),
          ) ?? [];
      if (occupied.length && !movePlates) {
        setMoving(occupied);
        return;
      }
      setBusy(true);
      setError(null);
      try {
        await mutateClient({
          tenantId,
          bearer: accessToken,
          isOnline,
          row: editing ?? undefined,
          body: {
            plates,
            cuit: cuit || null,
            name: form.name.trim() || null,
            nameIsAutomatic: form.nameAutomatic,
            email: form.email.trim() || null,
            phone: form.phone.trim() || null,
            movePlates,
          },
        });
        setOpen(false);
        setMoving(null);
        if (isOnline) void triggerSync();
      } catch (caught) {
        showToast({ message: translateApiError(caught), kind: 'error' });
      } finally {
        setBusy(false);
      }
    },
    [
      busy,
      form,
      rows,
      editing,
      tenantId,
      accessToken,
      isOnline,
      triggerSync,
      showToast,
    ],
  );

  const columns = useMemo<ColumnDef<LocalClient>[]>(
    () => [
      {
        accessorKey: 'name',
        header: 'Nombre',
        cell: ({ row }) => row.original.name || '—',
      },
      {
        id: 'plates',
        accessorFn: (row) => row.plates.join(', '),
        header: 'Patentes',
        size: 230,
        cell: ({ row }) => (
          <span className="dt-plate-list">
            {row.original.plates.map((plate) => (
              <PlateCell key={plate} plate={plate} />
            ))}
          </span>
        ),
      },
      {
        accessorKey: 'cuit',
        header: 'CUIT',
        cell: ({ row }) => row.original.cuit || '—',
      },
      {
        accessorKey: 'email',
        header: 'Email',
        cell: ({ row }) => row.original.email || '—',
      },
      {
        accessorKey: 'phone',
        header: 'Teléfono',
        cell: ({ row }) => row.original.phone || '—',
      },
      {
        accessorKey: 'updatedAt',
        header: 'Actualización',
        filterFn: 'dateRange',
        cell: ({ row }) => dateLabel(row.original.updatedAt),
      },
      {
        id: 'actions',
        header: 'Acciones',
        enableSorting: false,
        cell: ({ row }) => (
          <div className="dt-row-actions">
            <button
              className="table-icon-action"
              type="button"
              title="Editar cliente"
              aria-label={`Editar ${row.original.name || row.original.plates.join(', ')}`}
              onClick={() => begin(row.original)}
            >
              <Pencil size={16} />
            </button>
            <button
              className="table-icon-action danger"
              type="button"
              title="Eliminar cliente"
              aria-label={`Eliminar ${row.original.name || row.original.plates.join(', ')}`}
              onClick={() => setDeleting(row.original)}
            >
              <Trash2 size={16} />
            </button>
          </div>
        ),
      },
    ],
    [begin],
  );

  return (
    <section className="rates-panel">
      <div className="rates-layout readonly">
        <div className="rates-table-card data-table-host">
          <DataTable
            data={rows ?? []}
            columns={columns}
            title="Clientes"
            isLoading={rows === undefined}
            emptyMessage="No hay clientes registrados."
            searchPlaceholder="Buscar por nombre, patente, CUIT o contacto..."
            searchableKeys={['name', 'plates', 'cuit', 'email', 'phone']}
            filterableColumns={[
              'name',
              'plates',
              'cuit',
              'email',
              'phone',
              'updatedAt',
            ]}
            getRowId={(row) => row.id}
            initialPageSize={10}
            initialSorting={[{ id: 'updatedAt', desc: true }]}
            templateScope={{ tenantId, userId, tableKey: 'clients' }}
            onRefresh={() => void triggerSync()}
            refreshDisabled={!isOnline || busy}
            headerAction={
              <button
                type="button"
                className="primary-button compact rates-new-button"
                onClick={() => begin()}
              >
                <Plus size={17} />
                Agregar cliente
              </button>
            }
          />
        </div>
      </div>
      {open && (
        <div
          className="rate-dialog-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !busy && !moving)
              setOpen(false);
          }}
        >
          <form
            className="rate-dialog clients-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="client-title"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <header className="rate-dialog-header">
              <h3 id="client-title">
                {editing ? 'Editar cliente' : 'Agregar cliente'}
              </h3>
              <button
                type="button"
                className="rate-dialog-close"
                aria-label="Cerrar"
                disabled={busy}
                onClick={() => setOpen(false)}
              >
                <X size={18} />
              </button>
            </header>
            <div className="client-form-grid">
              <div className="form-field client-plate-field">
                <span className="field-label">Patentes</span>
                {form.plates.map((plate, index) => (
                  <div className="client-plate-row" key={index}>
                    <input
                      aria-label={`Patente ${index + 1}`}
                      value={plate}
                      maxLength={30}
                      autoFocus={index === 0}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          plates: current.plates.map((item, i) =>
                            i === index ? event.target.value : item,
                          ),
                        }))
                      }
                    />
                    {form.plates.length > 1 && (
                      <button
                        type="button"
                        className="table-icon-action"
                        title="Quitar patente"
                        aria-label={`Quitar patente ${index + 1}`}
                        onClick={() =>
                          setForm((current) => ({
                            ...current,
                            plates: current.plates.filter(
                              (_, i) => i !== index,
                            ),
                          }))
                        }
                      >
                        <X size={16} />
                      </button>
                    )}
                  </div>
                ))}
                <button
                  type="button"
                  className="ghost-button compact"
                  onClick={() =>
                    setForm((current) => ({
                      ...current,
                      plates: [...current.plates, ''],
                    }))
                  }
                >
                  <Plus size={16} />
                  Agregar patente
                </button>
              </div>
              {(['cuit', 'name', 'email', 'phone'] as const).map((key) => (
                <div className="form-field" key={key}>
                  <label className="field-label" htmlFor={`client-${key}`}>
                    {
                      {
                        cuit: 'CUIT',
                        name: 'Nombre',
                        email: 'Email',
                        phone: 'Teléfono',
                      }[key]
                    }{' '}
                    (opcional)
                  </label>
                  <input
                    id={`client-${key}`}
                    type={
                      key === 'email'
                        ? 'email'
                        : key === 'phone'
                          ? 'tel'
                          : 'text'
                    }
                    value={form[key]}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        [key]: event.target.value,
                        ...(key === 'name' && { nameAutomatic: false }),
                      }))
                    }
                    onBlur={
                      key === 'cuit' && isOnline
                        ? () => {
                            const cuit = form.cuit.replace(/\D/g, '');
                            if (cuit.length === 11 && !form.name.trim())
                              void lookupTaxpayer({
                                tenantId,
                                cuit,
                                bearer: accessToken,
                              })
                                .then((result) => {
                                  if (result.identified && result.razonSocial)
                                    setForm((current) =>
                                      current.name.trim() ||
                                      current.cuit.replace(/\D/g, '') !== cuit
                                        ? current
                                        : {
                                            ...current,
                                            name: result.razonSocial ?? '',
                                            nameAutomatic: true,
                                          },
                                    );
                                })
                                .catch(() => undefined);
                          }
                        : undefined
                    }
                  />
                </div>
              ))}
            </div>
            {error && (
              <p className="field-error" role="alert">
                {error}
              </p>
            )}
            <div className="rate-dialog-actions">
              <button type="submit" className="primary-button" disabled={busy}>
                {busy ? 'Guardando...' : 'Guardar'}
              </button>
            </div>
          </form>
        </div>
      )}
      <ConfirmDialog
        open={Boolean(moving)}
        title="Mover patente"
        message={`Las patentes ${moving?.join(', ') ?? ''} ya pertenecen a otro cliente. ¿Moverlas a esta ficha?`}
        confirmLabel="Mover y guardar"
        isPending={busy}
        onCancel={() => setMoving(null)}
        onConfirm={() => save(true)}
      />
      <ConfirmDialog
        open={Boolean(deleting)}
        title="Eliminar cliente"
        message={`¿Eliminar ${deleting?.name || deleting?.plates.join(', ') || 'este cliente'}? Sus contactos no aparecerán al facturar.`}
        confirmLabel="Eliminar"
        variant="danger"
        isPending={busy}
        onCancel={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return;
          setBusy(true);
          try {
            await mutateClient({
              tenantId,
              bearer: accessToken,
              isOnline,
              row: deleting,
              remove: true,
            });
            setDeleting(null);
            if (isOnline) void triggerSync();
          } catch (caught) {
            showToast({ message: translateApiError(caught), kind: 'error' });
          } finally {
            setBusy(false);
          }
        }}
      />
    </section>
  );
}
