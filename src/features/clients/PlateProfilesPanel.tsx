import { useMemo, useRef, useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { ColumnDef } from '@tanstack/react-table';
import { Pencil, Plus, RotateCw, Trash2, X } from 'lucide-react';
import { createVehicleSearchModes, DataTable } from '../data-table';
import { PlateCell } from '../data-table/components/PlateCell';
import { VehicleCell } from '../data-table/components/VehicleCell';
import {
  VehicleSuggestionsPortal,
  type VehicleSuggestion,
} from '../entries/EntryFormCore';
import { localDb, type LocalPlateProfile } from '../../lib/db/localDb';
import { useNetwork } from '../../lib/network/NetworkContext';
import { useSync } from '../../lib/sync/SyncContext';
import { useToast } from '../../lib/notifications/ToastProvider';
import { ApiError } from '../../lib/api/client';
import { translateApiError } from '../../lib/api/translate';
import { getPlateProfile } from '../../lib/api/plate-profiles';
import { AppSelect } from '../../lib/ui/AppSelect';
import { ConfirmDialog } from '../../lib/ui/ConfirmDialog';
import { COLORS } from '../../lib/data/colors';
import { formatArgentinaDateTime } from '../../lib/format/argentina';
import { normalizeClientPlate } from './clientUtils';
import {
  mutatePlateProfile,
  type PlateProfileFields,
} from './plateProfileMutations';
import { emptyPlateProfile, profileToLocal } from './plateProfiles';

type Props = {
  tenantId: string;
  accessToken: string;
  userId: string;
  headerTabs?: ReactNode;
};
type Form = {
  plate: string;
  vehicle: string;
  brand: string;
  model: string;
  selected: boolean;
  typeId: string;
  color: string;
  rateId: string;
};
const empty: Form = {
  plate: '',
  vehicle: '',
  brand: '',
  model: '',
  selected: false,
  typeId: '',
  color: '',
  rateId: '',
};
const SEARCH_MODES = createVehicleSearchModes<LocalPlateProfile>({
  plate: (row) => row.plate,
});

export function PlateProfilesPanel({
  tenantId,
  accessToken,
  userId,
  headerTabs,
}: Props) {
  const { isOnline } = useNetwork();
  const { triggerSync } = useSync();
  const { showToast } = useToast();
  const savedRows = useLiveQuery(
    () => localDb.plateProfiles.where('tenantId').equals(tenantId).toArray(),
    [tenantId],
  );
  const blocked = useLiveQuery(
    () =>
      localDb.pendingOps
        .where('entityType')
        .equals('plateProfile')
        .filter(
          (op) =>
            op.tenantId === tenantId &&
            op.userId === userId &&
            (op.status === 'conflict' || op.status === 'failed'),
        )
        .toArray(),
    [tenantId, userId],
  );
  const blockedPlates = useMemo(
    () => new Set(blocked?.map((op) => op.entityId)),
    [blocked],
  );
  const rows = useMemo(
    () =>
      savedRows?.filter(
        (row) => !row.deletedAt || blockedPlates.has(row.plate),
      ),
    [savedRows, blockedPlates],
  );
  const catalog = useLiveQuery(
    () =>
      localDb.vehicles
        .where('tenantId')
        .equals(tenantId)
        .filter((row) => !row.deletedAt)
        .toArray(),
    [tenantId],
  );
  const types = useLiveQuery(
    () =>
      localDb.vehicleTypes
        .where('tenantId')
        .equals(tenantId)
        .filter((row) => !row.deletedAt)
        .toArray(),
    [tenantId],
  );
  const rates = useLiveQuery(
    () =>
      localDb.rates
        .where('tenantId')
        .equals(tenantId)
        .filter((row) => !row.deletedAt && row.isActive)
        .toArray(),
    [tenantId],
  );
  const [editing, setEditing] = useState<LocalPlateProfile | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Form>(empty);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const [deleting, setDeleting] = useState<LocalPlateProfile | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const suggestions = useMemo<VehicleSuggestion[]>(() => {
    const query = form.vehicle.trim().toLowerCase();
    if (!query || form.selected) return [];
    return (catalog ?? [])
      .filter((row) =>
        `${row.brand} ${row.model}`.toLowerCase().includes(query),
      )
      .slice(0, 10)
      .map((row) => ({
        kind: 'model',
        brand: row.brand,
        model: row.model,
        label: `${row.brand} ${row.model}`,
      }));
  }, [catalog, form.vehicle, form.selected]);

  function begin(row?: LocalPlateProfile) {
    setEditing(row ?? null);
    setForm(
      row
        ? {
            plate: row.plate,
            vehicle: [row.vehicleBrand, row.vehicleModel]
              .filter(Boolean)
              .join(' '),
            brand: row.vehicleBrand ?? '',
            model: row.vehicleModel ?? '',
            selected: true,
            typeId: row.vehicleTypeId ?? '',
            color: row.color ?? '',
            rateId: row.rateId ?? '',
          }
        : empty,
    );
    setError(
      row && blockedPlates.has(row.plate)
        ? 'La ficha requiere revisión. Recargá su versión antes de reintentar.'
        : '',
    );
    setConflict(Boolean(row && blockedPlates.has(row.plate)));
    setSuggesting(false);
    setOpen(true);
  }
  function choose(suggestion: VehicleSuggestion) {
    const model = suggestion.kind === 'model' ? suggestion.model : '';
    const vehicle = catalog?.find(
      (row) => row.brand === suggestion.brand && row.model === model,
    );
    setForm((current) => ({
      ...current,
      vehicle: suggestion.label,
      brand: suggestion.brand,
      model,
      selected: true,
      typeId: vehicle?.typeId ?? '',
    }));
    setSuggesting(false);
  }
  async function save() {
    if (busy) return;
    const plate = normalizeClientPlate(form.plate);
    if (!/^[A-Z0-9]{1,20}$/.test(plate)) {
      setError('Ingresá una patente válida.');
      return;
    }
    if (!editing && rows?.some((row) => row.plate === plate)) {
      setError('Ya existe una ficha para esa patente.');
      return;
    }
    if (!form.selected && suggestions.length) {
      setError('Seleccioná un vehículo de las opciones.');
      return;
    }
    if (form.vehicle.trim() && !form.typeId) {
      setError('Seleccioná el tipo de vehículo.');
      return;
    }
    const body: PlateProfileFields = {
      vehicleBrand: (form.selected ? form.brand : '') || null,
      vehicleModel: (form.selected ? form.model : form.vehicle.trim()) || null,
      vehicleTypeId: form.typeId || null,
      color: form.color || null,
      rateId: form.rateId || null,
    };
    setBusy(true);
    setError('');
    try {
      await mutatePlateProfile({
        tenantId,
        bearer: accessToken,
        userId,
        isOnline,
        plate,
        row: editing ?? undefined,
        body,
        labels: {
          vehicleTypeName: form.typeId
            ? (types?.find((row) => row.id === form.typeId)?.name ??
              editing?.vehicleTypeName ??
              null)
            : null,
          rateName: form.rateId
            ? (rates?.find((row) => row.id === form.rateId)?.name ??
              editing?.rateName ??
              null)
            : null,
        },
      });
      setOpen(false);
      if (isOnline) void triggerSync();
    } catch (caught) {
      setError(translateApiError(caught));
      setConflict(caught instanceof ApiError && caught.status === 409);
    } finally {
      setBusy(false);
    }
  }
  async function reloadVersion(row: LocalPlateProfile) {
    setBusy(true);
    try {
      const fresh = profileToLocal(
        await getPlateProfile({
          tenantId,
          bearer: accessToken,
          plate: row.plate,
        }),
      );
      await localDb.transaction(
        'rw',
        localDb.plateProfiles,
        localDb.pendingOps,
        async () => {
          await localDb.pendingOps
            .where('entityType')
            .equals('plateProfile')
            .filter(
              (op) =>
                op.tenantId === tenantId &&
                op.entityId === row.plate &&
                op.userId === userId &&
                op.status !== 'in-flight',
            )
            .delete();
          await localDb.plateProfiles.put(fresh);
        },
      );
      setEditing(fresh);
      setConflict(false);
      setError('');
    } catch (caught) {
      setError(translateApiError(caught));
    } finally {
      setBusy(false);
    }
  }

  const columns = useMemo<ColumnDef<LocalPlateProfile>[]>(
    () => [
      {
        accessorKey: 'plate',
        header: 'Patente',
        cell: ({ row }) => (
          <div>
            <PlateCell plate={row.original.plate} />
            {blockedPlates.has(row.original.plate) && (
              <span className="field-error">
                {row.original.deletedAt
                  ? 'Eliminación pendiente'
                  : 'Requiere revisión'}
              </span>
            )}
          </div>
        ),
      },
      {
        id: 'vehicle',
        header: 'Vehículo',
        accessorFn: (row) =>
          [row.vehicleBrand, row.vehicleModel, row.color]
            .filter(Boolean)
            .join(' '),
        cell: ({ row }) => (
          <VehicleCell
            brand={row.original.vehicleBrand}
            model={row.original.vehicleModel}
            color={row.original.color}
          />
        ),
      },
      ...(['vehicleBrand', 'vehicleModel', 'color'] as const).map((key, i) => ({
        accessorKey: key,
        header: ['Marca', 'Modelo', 'Color'][i],
        meta: { filterOnly: true, displayColumnId: 'vehicle' },
      })),
      {
        accessorKey: 'vehicleTypeName',
        header: 'Tipo',
        cell: ({ row }) => row.original.vehicleTypeName || '—',
      },
      {
        accessorKey: 'rateName',
        header: 'Tarifa',
        cell: ({ row }) => row.original.rateName || '—',
      },
      {
        accessorKey: 'lastEnteredAt',
        header: 'Último ingreso',
        filterFn: 'dateRange',
        cell: ({ row }) =>
          row.original.lastEnteredAt
            ? formatArgentinaDateTime(row.original.lastEnteredAt)
            : '—',
      },
      {
        id: 'actions',
        header: 'Acciones',
        enableSorting: false,
        cell: ({ row }) => (
          <div className="dt-row-actions">
            <button
              type="button"
              className="table-icon-action"
              title="Editar vehículo"
              aria-label={`Editar ${row.original.plate}`}
              onClick={() => begin(row.original)}
            >
              <Pencil size={16} />
            </button>
            <button
              type="button"
              className="table-icon-action danger"
              title="Eliminar ficha de vehículo"
              aria-label={`Eliminar ${row.original.plate}`}
              onClick={() => setDeleting(row.original)}
            >
              <Trash2 size={16} />
            </button>
          </div>
        ),
      },
    ],
    [blockedPlates],
  );

  return (
    <section className="rates-panel">
      <div className="rates-layout readonly">
        <div className="rates-table-card data-table-host">
          <DataTable
            data={rows ?? []}
            columns={columns}
            title="Clientes"
            headerTabs={headerTabs}
            isLoading={rows === undefined}
            emptyMessage="No hay vehículos registrados."
            searchPlaceholder="Buscar por patente, vehículo, color o tarifa..."
            searchModes={SEARCH_MODES}
            searchableKeys={[
              'plate',
              'vehicleBrand',
              'vehicleModel',
              'vehicleTypeName',
              'color',
              'rateName',
            ]}
            filterableColumns={[
              'plate',
              'vehicleBrand',
              'vehicleModel',
              'color',
              'vehicleTypeName',
              'rateName',
              'lastEnteredAt',
            ]}
            getRowId={(row) => row.key}
            initialPageSize={10}
            initialSorting={[{ id: 'lastEnteredAt', desc: true }]}
            templateScope={{ tenantId, userId, tableKey: 'client-vehicles' }}
            onRefresh={() => void triggerSync()}
            refreshDisabled={!isOnline || busy}
            headerAction={
              <button
                type="button"
                className="primary-button compact rates-new-button"
                onClick={() => begin()}
              >
                <Plus size={17} />
                Agregar vehículo
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
            if (event.target === event.currentTarget && !busy) setOpen(false);
          }}
        >
          <form
            className="rate-dialog clients-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="plate-profile-title"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && !busy) {
                event.stopPropagation();
                if (suggesting) setSuggesting(false);
                else setOpen(false);
              }
            }}
          >
            <div className="rate-dialog-header">
              <h3 id="plate-profile-title">
                {editing ? 'Editar vehículo' : 'Agregar vehículo'}
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
            </div>
            <fieldset disabled={busy} className="client-profile-fields">
              <div className="client-form-grid">
                <label className="form-field">
                  Patente
                  <input
                    value={form.plate}
                    disabled={Boolean(editing)}
                    maxLength={20}
                    autoFocus={!editing}
                    onChange={(e) =>
                      setForm((current) => ({
                        ...current,
                        plate: normalizeClientPlate(e.target.value),
                      }))
                    }
                  />
                </label>
                <label className="form-field">
                  Vehículo
                  <input
                    ref={inputRef}
                    autoFocus={Boolean(editing)}
                    value={form.vehicle}
                    maxLength={120}
                    autoComplete="off"
                    role="combobox"
                    aria-expanded={suggesting && suggestions.length > 0}
                    aria-autocomplete="list"
                    placeholder="Marca o modelo"
                    onChange={(e) => {
                      setForm((current) => ({
                        ...current,
                        vehicle: e.target.value,
                        selected: false,
                        brand: '',
                        model: '',
                      }));
                      setHighlight(0);
                      setSuggesting(true);
                    }}
                    onFocus={() => setSuggesting(true)}
                    onBlur={() => setSuggesting(false)}
                    onKeyDown={(event) => {
                      if (
                        event.key === 'ArrowDown' ||
                        event.key === 'ArrowUp'
                      ) {
                        event.preventDefault();
                        setSuggesting(true);
                        setHighlight((h) =>
                          Math.max(
                            0,
                            Math.min(
                              suggestions.length - 1,
                              h + (event.key === 'ArrowDown' ? 1 : -1),
                            ),
                          ),
                        );
                      }
                      if (
                        event.key === 'Enter' &&
                        suggesting &&
                        suggestions[highlight]
                      ) {
                        event.preventDefault();
                        choose(suggestions[highlight]);
                      }
                    }}
                  />
                </label>
                <VehicleSuggestionsPortal
                  inputRef={inputRef}
                  suggestions={suggestions}
                  onSelect={choose}
                  open={suggesting && !busy}
                  highlightedIdx={highlight}
                />
                <div className="form-field">
                  <label htmlFor="profile-type">Tipo de vehículo</label>
                  <AppSelect
                    id="profile-type"
                    value={form.typeId}
                    disabled={busy}
                    onChange={(typeId) =>
                      setForm((current) => ({ ...current, typeId }))
                    }
                    options={[
                      { value: '', label: 'Sin tipo' },
                      ...(types ?? []).map((row) => ({
                        value: row.id,
                        label: row.name,
                      })),
                      ...(form.typeId &&
                      !types?.some((row) => row.id === form.typeId)
                        ? [
                            {
                              value: form.typeId,
                              label: `${editing?.vehicleTypeName ?? 'Tipo anterior'} (no disponible)`,
                            },
                          ]
                        : []),
                    ]}
                  />
                </div>
                <div className="form-field">
                  <label htmlFor="profile-color">Color</label>
                  <AppSelect
                    id="profile-color"
                    value={form.color}
                    disabled={busy}
                    onChange={(color) =>
                      setForm((current) => ({ ...current, color }))
                    }
                    options={[
                      { value: '', label: 'Sin color' },
                      ...COLORS.map((color) => ({
                        value: color,
                        label: color,
                      })),
                      ...(form.color && !COLORS.some((c) => c === form.color)
                        ? [
                            {
                              value: form.color,
                              label: `${form.color} (no disponible)`,
                            },
                          ]
                        : []),
                    ]}
                  />
                </div>
                <div className="form-field">
                  <label htmlFor="profile-rate">Tarifa sugerida</label>
                  <AppSelect
                    id="profile-rate"
                    value={form.rateId}
                    disabled={busy}
                    onChange={(rateId) =>
                      setForm((current) => ({ ...current, rateId }))
                    }
                    options={[
                      { value: '', label: 'Sin tarifa' },
                      ...(rates ?? []).map((row) => ({
                        value: row.id,
                        label: row.name,
                      })),
                      ...(form.rateId &&
                      !rates?.some((row) => row.id === form.rateId)
                        ? [
                            {
                              value: form.rateId,
                              label: `${editing?.rateName ?? 'Tarifa anterior'} (no disponible)`,
                            },
                          ]
                        : []),
                    ]}
                  />
                </div>
              </div>
            </fieldset>
            {error && (
              <p className="field-error" role="alert">
                {error}
              </p>
            )}
            {conflict && (
              <button
                type="button"
                className="secondary-button"
                disabled={!isOnline || busy}
                title="Recargar la versión conservando los cambios del formulario"
                onClick={() =>
                  void reloadVersion(
                    editing ??
                      emptyPlateProfile(
                        tenantId,
                        normalizeClientPlate(form.plate),
                      ),
                  )
                }
              >
                <RotateCw size={16} />
                Recargar versión
              </button>
            )}
            <div className="rate-dialog-actions">
              <button
                type="submit"
                className="primary-button"
                disabled={busy || conflict}
              >
                {busy ? 'Guardando...' : 'Guardar'}
              </button>
            </div>
          </form>
        </div>
      )}
      <ConfirmDialog
        open={Boolean(deleting)}
        title="Eliminar ficha de vehículo"
        message={`¿Eliminar la ficha de ${deleting?.plate ?? ''}? No se modificarán sus estadías ni sus datos de facturación.`}
        confirmLabel="Eliminar"
        variant="danger"
        isPending={busy}
        onCancel={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting || busy) return;
          setBusy(true);
          try {
            await mutatePlateProfile({
              tenantId,
              bearer: accessToken,
              userId,
              isOnline,
              plate: deleting.plate,
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
