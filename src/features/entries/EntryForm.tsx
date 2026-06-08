import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState } from 'react';
import { createEntry } from '../../lib/api/entries';
import { createVehicle } from '../../lib/api/vehicles';
import { translateApiError } from '../../lib/api/translate';
import { localDb, type LocalEntry } from '../../lib/db/localDb';
import { useNetwork } from '../../lib/network/NetworkContext';
import { useToast } from '../../lib/notifications/ToastProvider';
import { formatArs } from '../../lib/format/argentina';
import { searchBrands, searchModels } from '../../lib/data/vehicleBrands';
import { generateUuidV7 } from './entryUtils';

interface Props {
  tenantId: string;
  accessToken: string;
}

export function EntryForm({ tenantId, accessToken }: Props) {
  const { showToast } = useToast();
  const { isOnline } = useNetwork();
  const [plate, setPlate] = useState('');
  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  const [color, setColor] = useState('');
  const [rateId, setRateId] = useState('');
  const [cochera, setCochera] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const plateResolved = useRef(false);

  const activeRates = useLiveQuery(
    () =>
      localDb.rates
        .where('tenantId')
        .equals(tenantId)
        .filter((r) => r.isActive)
        .sortBy('name'),
    [tenantId],
  );

  // When plate is typed, look up a previous vehicle with that plate → pre-fill brand/model.
  async function handlePlateBlur() {
    const normalized = plate.trim().toUpperCase();
    if (!normalized || plateResolved.current) return;

    const vehicle = await localDb.vehicles
      .where('plate')
      .equals(normalized)
      .first();
    if (vehicle) {
      if (!brand) setBrand(vehicle.brand);
      if (!model) setModel(vehicle.model);
      plateResolved.current = true;
    }
  }

  useEffect(() => {
    plateResolved.current = false;
  }, [plate]);

  async function findOrCreateVehicleId(
    normalizedPlate: string,
    vehicleBrand: string,
    vehicleModel: string,
  ): Promise<string> {
    // Reuse vehicle by plate if it already exists in localDb.
    const existing = await localDb.vehicles
      .where('plate')
      .equals(normalizedPlate)
      .first();
    if (existing) return existing.id;

    // Also check previous entries for the same plate (handles case where vehicle
    // was created before plate field was added).
    const prev = await localDb.entries
      .where('tenantId')
      .equals(tenantId)
      .filter((e) => e.plate === normalizedPlate)
      .first();
    if (prev) return prev.vehicleId;

    // New vehicle — generate UUID and create.
    const vehicleId = generateUuidV7();
    const vehicleBody = {
      id: vehicleId,
      plate: normalizedPlate,
      brand: vehicleBrand || normalizedPlate,
      model: vehicleModel || 'Auto',
    };

    if (isOnline) {
      await createVehicle({ bearer: accessToken, body: vehicleBody });
    } else {
      await localDb.transaction(
        'rw',
        localDb.vehicles,
        localDb.pendingOps,
        async () => {
          await localDb.vehicles.put({
            id: vehicleId,
            plate: normalizedPlate,
            brand: vehicleBody.brand,
            model: vehicleBody.model,
          });
          await localDb.pendingOps.add({
            entityType: 'vehicle',
            operation: 'create',
            tenantId,
            entityId: vehicleId,
            payload: vehicleBody,
            status: 'pending',
            createdAt: Date.now(),
            retryCount: 0,
          });
        },
      );
      return vehicleId;
    }

    await localDb.vehicles.put({
      id: vehicleId,
      plate: normalizedPlate,
      brand: vehicleBody.brand,
      model: vehicleBody.model,
    });
    return vehicleId;
  }

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();

    const normalizedPlate = plate.trim().toUpperCase();
    if (!normalizedPlate) {
      showToast({ message: 'Ingresá la patente.', kind: 'error' });
      return;
    }

    const selectedRate = activeRates?.find((r) => r.id === rateId);

    setSaving(true);
    try {
      const vehicleId = await findOrCreateVehicleId(
        normalizedPlate,
        brand.trim(),
        model.trim(),
      );
      const entryId = generateUuidV7();
      const now = new Date().toISOString();

      const body = {
        id: entryId,
        plate: normalizedPlate,
        color: color.trim() || undefined,
        cochera: cochera.trim() || undefined,
        notes: notes.trim() || undefined,
        enteredAt: now,
        vehicleId,
        rateId: selectedRate?.id,
        rateSnapshotName: selectedRate?.name,
        rateSnapshotHourPriceArs: selectedRate
          ? parseFloat(selectedRate.hourPriceArs)
          : undefined,
        rateSnapshotStayPriceArs: selectedRate
          ? parseFloat(selectedRate.stayPriceArs)
          : undefined,
        rateSnapshotFractionPriceArs: selectedRate
          ? parseFloat(selectedRate.fractionPriceArs)
          : undefined,
      };

      if (isOnline) {
        const result = await createEntry({
          tenantId,
          bearer: accessToken,
          body,
        });
        const localEntry: LocalEntry = {
          id: result.id,
          tenantId: result.tenantId,
          plate: result.plate,
          color: result.color ?? undefined,
          cochera: result.cochera ?? undefined,
          notes: result.notes ?? undefined,
          enteredAt: result.enteredAt,
          leftAt: result.leftAt ?? undefined,
          vehicleId: result.vehicleId,
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
        };
        await localDb.entries.put(localEntry);
      } else {
        await localDb.transaction(
          'rw',
          localDb.entries,
          localDb.pendingOps,
          async () => {
            await localDb.entries.put({
              id: entryId,
              tenantId,
              plate: normalizedPlate,
              color: color.trim() || undefined,
              cochera: cochera.trim() || undefined,
              notes: notes.trim() || undefined,
              enteredAt: now,
              vehicleId,
              vehicleBrand: brand.trim() || undefined,
              vehicleModel: model.trim() || undefined,
              rateId: selectedRate?.id,
              rateSnapshotName: selectedRate?.name,
              rateSnapshotHourPriceArs: selectedRate?.hourPriceArs,
              rateSnapshotStayPriceArs: selectedRate?.stayPriceArs,
              rateSnapshotFractionPriceArs: selectedRate?.fractionPriceArs,
              version: 1,
              syncSeq: 0,
              updatedAt: now,
            });
            await localDb.pendingOps.add({
              entityType: 'entry',
              operation: 'create',
              tenantId,
              entityId: entryId,
              payload: body,
              status: 'pending',
              createdAt: Date.now(),
              retryCount: 0,
            });
          },
        );
      }

      showToast({
        message: isOnline
          ? `Ingreso registrado: ${normalizedPlate}`
          : `Guardado localmente: ${normalizedPlate}`,
        kind: 'success',
      });

      setPlate('');
      setBrand('');
      setModel('');
      setColor('');
      setRateId('');
      setCochera('');
      setNotes('');
    } catch (error) {
      showToast({ message: translateApiError(error), kind: 'error' });
    } finally {
      setSaving(false);
    }
  }

  // Build autocomplete suggestions for brand.
  const brandSuggestions = brand.length >= 1 ? searchBrands(brand) : [];
  const modelSuggestions = model.length >= 0 ? searchModels(brand, model) : [];

  return (
    <form
      className="entry-form"
      onSubmit={(e) => {
        void handleSubmit(e);
      }}
    >
      <h3 className="entry-form-title">Registrar ingreso</h3>

      <div className="entry-form-fields">
        <div className="form-field">
          <input
            type="text"
            placeholder="Patente (ej. ABC123)"
            value={plate}
            onChange={(e) => {
              setPlate(e.target.value.toUpperCase());
            }}
            onBlur={() => {
              void handlePlateBlur();
            }}
            className="entry-form-plate"
            maxLength={20}
            autoFocus
          />
        </div>

        <div className="form-field entry-form-vehicle-row">
          <div className="form-field-half">
            <input
              list="brand-suggestions"
              type="text"
              placeholder="Marca (ej. Volkswagen)"
              value={brand}
              onChange={(e) => {
                setBrand(e.target.value);
                setModel('');
              }}
              maxLength={120}
            />
            <datalist id="brand-suggestions">
              {brandSuggestions.map((b) => (
                <option key={b} value={b} />
              ))}
            </datalist>
          </div>

          <div className="form-field-half">
            <input
              list="model-suggestions"
              type="text"
              placeholder="Modelo (ej. Bora)"
              value={model}
              onChange={(e) => {
                setModel(e.target.value);
              }}
              maxLength={120}
            />
            <datalist id="model-suggestions">
              {modelSuggestions.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </div>
        </div>

        <div className="form-field">
          <input
            type="text"
            placeholder="Color (opcional)"
            value={color}
            onChange={(e) => {
              setColor(e.target.value);
            }}
            maxLength={50}
          />
        </div>

        <div className="form-field">
          <select
            value={rateId}
            onChange={(e) => {
              setRateId(e.target.value);
            }}
            className="entry-form-rate-select"
          >
            <option value="">Sin tarifa seleccionada</option>
            {(activeRates ?? []).map((r) => (
              <option key={r.id} value={r.id}>
                {r.name} — Hora: {formatArs(r.hourPriceArs)}
              </option>
            ))}
          </select>
        </div>

        <div className="form-field">
          <input
            type="text"
            placeholder="Cochera (opcional)"
            value={cochera}
            onChange={(e) => {
              setCochera(e.target.value);
            }}
            maxLength={100}
          />
        </div>

        <div className="form-field">
          <input
            type="text"
            placeholder="Notas (opcional)"
            value={notes}
            onChange={(e) => {
              setNotes(e.target.value);
            }}
            maxLength={500}
          />
        </div>

        <button
          type="submit"
          className="primary-button"
          disabled={saving || !plate.trim()}
        >
          {saving ? 'Registrando...' : 'Registrar ingreso'}
        </button>
      </div>
    </form>
  );
}
