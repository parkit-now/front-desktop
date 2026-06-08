import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createEntry } from '../../lib/api/entries';
import { translateApiError } from '../../lib/api/translate';
import { localDb, type LocalEntry } from '../../lib/db/localDb';
import { useNetwork } from '../../lib/network/NetworkContext';
import { useToast } from '../../lib/notifications/ToastProvider';
import { formatArs } from '../../lib/format/argentina';
import { getAllStaticVehicles } from '../../lib/data/vehicleBrands';
import { generateUuidV7 } from './entryUtils';

interface Props {
  tenantId: string;
  accessToken: string;
}

type VehicleSuggestion =
  | { kind: 'model'; label: string; brand: string; model: string }
  | { kind: 'brand'; label: string; brand: string };

const SUGGESTION_LIMIT = 10;

export function EntryForm({ tenantId, accessToken }: Props) {
  const { showToast } = useToast();
  const { isOnline } = useNetwork();
  const [plate, setPlate] = useState('');
  // Internal brand/model state — driven by suggestion selection or plate pre-fill.
  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  // Combined display field for vehicle autocomplete.
  const [vehicleInput, setVehicleInput] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [color, setColor] = useState('');
  const [rateId, setRateId] = useState('');
  const [cochera, setCochera] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const plateResolved = useRef(false);
  // True when the user explicitly selected a suggestion (brand+model resolved).
  const suggestionSelected = useRef(false);
  const suggestionsRef = useRef<HTMLUListElement>(null);

  const activeRates = useLiveQuery(
    () =>
      localDb.rates
        .where('tenantId')
        .equals(tenantId)
        .filter((r) => r.isActive)
        .sortBy('name'),
    [tenantId],
  );

  // Catalog vehicles visible to this tenant (global + own). Exclude soft-deleted.
  const catalogVehicles = useLiveQuery(
    () => localDb.vehicles.filter((v) => !v.deletedAt).toArray(),
    [],
  );

  useEffect(() => {
    plateResolved.current = false;
  }, [plate]);

  // On plate blur: look up previous entries for this tenant with the same plate
  // and pre-fill vehicle, color and last rate if the fields are currently empty.
  async function handlePlateBlur() {
    const normalized = plate.trim().toUpperCase();
    if (!normalized || plateResolved.current) return;

    const prev = await localDb.entries
      .where('tenantId')
      .equals(tenantId)
      .filter((e) => e.plate === normalized)
      .first();

    if (prev) {
      if (!color && prev.color) setColor(prev.color);
      if (!rateId && prev.rateId) setRateId(prev.rateId);
      if (prev.vehicleBrand && !vehicleInput) {
        const b = prev.vehicleBrand;
        const m = prev.vehicleModel ?? '';
        setBrand(b);
        setModel(m);
        setVehicleInput(m ? `${b} ${m}` : b);
        suggestionSelected.current = true;
      }
      plateResolved.current = true;
    }
  }

  // Build combined suggestions: models prioritized over brands.
  const suggestions = useMemo<VehicleSuggestion[]>(() => {
    const q = vehicleInput.trim().toLowerCase();
    if (!q || suggestionSelected.current) return [];

    // Use localDb catalog if populated, otherwise fall back to static data.
    const source: { brand: string; model: string }[] =
      catalogVehicles && catalogVehicles.length > 0
        ? catalogVehicles
        : getAllStaticVehicles();

    // Compute which model names appear under more than one brand (ambiguous).
    const modelBrands = new Map<string, Set<string>>();
    for (const v of source) {
      const key = v.model.toLowerCase();
      if (!modelBrands.has(key)) modelBrands.set(key, new Set());
      modelBrands.get(key)!.add(v.brand.toLowerCase());
    }
    const ambiguous = new Set(
      [...modelBrands.entries()]
        .filter(([, brands]) => brands.size > 1)
        .map(([m]) => m),
    );

    const result: VehicleSuggestion[] = [];
    const seenModels = new Set<string>();
    const seenBrands = new Set<string>();

    // Model suggestions first.
    for (const v of source) {
      if (!v.model.toLowerCase().includes(q)) continue;
      const key = `${v.brand}|${v.model}`;
      if (seenModels.has(key)) continue;
      seenModels.add(key);
      const isAmbig = ambiguous.has(v.model.toLowerCase());
      result.push({
        kind: 'model',
        label: isAmbig ? `${v.model} — ${v.brand}` : v.model,
        brand: v.brand,
        model: v.model,
      });
      if (result.length >= SUGGESTION_LIMIT) break;
    }

    // Brand suggestions after.
    if (result.length < SUGGESTION_LIMIT) {
      for (const v of source) {
        if (!v.brand.toLowerCase().includes(q)) continue;
        if (seenBrands.has(v.brand)) continue;
        seenBrands.add(v.brand);
        result.push({ kind: 'brand', label: v.brand, brand: v.brand });
        if (result.length >= SUGGESTION_LIMIT) break;
      }
    }

    return result;
  }, [vehicleInput, catalogVehicles]);

  function selectSuggestion(s: VehicleSuggestion) {
    const b = s.brand;
    const m = s.kind === 'model' ? s.model : '';
    setBrand(b);
    setModel(m);
    setVehicleInput(m ? `${b} ${m}` : b);
    suggestionSelected.current = true;
    setShowSuggestions(false);
  }

  function handleVehicleInputChange(value: string) {
    setVehicleInput(value);
    suggestionSelected.current = false;
    // Clear resolved brand/model so submit uses vehicleInput as raw model.
    setBrand('');
    setModel('');
    setShowSuggestions(true);
  }

  function handleVehicleInputBlur() {
    // Delay so a click on a suggestion registers before hiding.
    setTimeout(() => setShowSuggestions(false), 150);
  }

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();

    const normalizedPlate = plate.trim().toUpperCase();
    if (!normalizedPlate) {
      showToast({ message: 'Ingresá la patente.', kind: 'error' });
      return;
    }

    // If no suggestion was selected, treat the raw input as vehicleModel.
    const finalBrand = suggestionSelected.current ? brand : '';
    const finalModel = suggestionSelected.current ? model : vehicleInput.trim();

    const selectedRate = activeRates?.find((r) => r.id === rateId);
    const entryId = generateUuidV7();
    const now = new Date().toISOString();

    const body = {
      id: entryId,
      plate: normalizedPlate,
      color: color.trim() || undefined,
      cochera: cochera.trim() || undefined,
      notes: notes.trim() || undefined,
      enteredAt: now,
      vehicleBrand: finalBrand || undefined,
      vehicleModel: finalModel || undefined,
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

    setSaving(true);
    try {
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
              vehicleBrand: finalBrand || undefined,
              vehicleModel: finalModel || undefined,
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
      setVehicleInput('');
      setColor('');
      setRateId('');
      setCochera('');
      setNotes('');
      suggestionSelected.current = false;
    } catch (error) {
      showToast({ message: translateApiError(error), kind: 'error' });
    } finally {
      setSaving(false);
    }
  }

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

        <div className="form-field entry-form-vehicle-wrapper">
          <div className="entry-form-vehicle-input-container">
            <input
              type="text"
              placeholder="Vehículo (ej. Bora, BMW, Toyota Hilux)"
              value={vehicleInput}
              onChange={(e) => {
                handleVehicleInputChange(e.target.value);
              }}
              onFocus={() => {
                if (!suggestionSelected.current && vehicleInput) {
                  setShowSuggestions(true);
                }
              }}
              onBlur={handleVehicleInputBlur}
              maxLength={120}
              autoComplete="off"
            />
            {showSuggestions && suggestions.length > 0 && (
              <ul
                className="vehicle-suggestions"
                ref={suggestionsRef}
                onMouseDown={(e) => e.preventDefault()}
              >
                {suggestions.map((s, i) => (
                  <li
                    key={i}
                    className={`vehicle-suggestion vehicle-suggestion--${s.kind}`}
                    onClick={() => selectSuggestion(s)}
                  >
                    {s.label}
                    {s.kind === 'brand' && (
                      <span className="vehicle-suggestion-tag">marca</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
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
