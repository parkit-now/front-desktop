import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { createEntry } from '../../lib/api/entries';
import { createVehicle } from '../../lib/api/vehicles';
import { translateApiError } from '../../lib/api/translate';
import { localDb, type LocalEntry } from '../../lib/db/localDb';
import { useNetwork } from '../../lib/network/NetworkContext';
import { useToast } from '../../lib/notifications/ToastProvider';
import { formatArs } from '../../lib/format/argentina';
import { generateUuidV7 } from './entryUtils';

interface Props {
  tenantId: string;
  accessToken: string;
}

export function EntryForm({ tenantId, accessToken }: Props) {
  const { showToast } = useToast();
  const { isOnline } = useNetwork();
  const [plate, setPlate] = useState('');
  const [color, setColor] = useState('');
  const [rateId, setRateId] = useState('');
  const [saving, setSaving] = useState(false);

  const activeRates = useLiveQuery(
    () =>
      localDb.rates
        .where('tenantId')
        .equals(tenantId)
        .filter((r) => r.isActive)
        .sortBy('name'),
    [tenantId],
  );

  async function findOrCreateVehicleId(
    normalizedPlate: string,
  ): Promise<string> {
    // Reuse vehicleId from a previous entry with the same plate
    const prev = await localDb.entries
      .where('tenantId')
      .equals(tenantId)
      .filter((e) => e.plate === normalizedPlate)
      .first();

    if (prev) return prev.vehicleId;

    // New vehicle
    const vehicleId = generateUuidV7();
    const vehicleBody = {
      id: vehicleId,
      brand: normalizedPlate,
      model: 'Auto',
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
            brand: normalizedPlate,
            model: 'Auto',
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
    }

    await localDb.vehicles.put({
      id: vehicleId,
      brand: normalizedPlate,
      model: 'Auto',
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
      const vehicleId = await findOrCreateVehicleId(normalizedPlate);
      const entryId = generateUuidV7();
      const now = new Date().toISOString();

      const body = {
        id: entryId,
        plate: normalizedPlate,
        color: color.trim() || undefined,
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
          enteredAt: result.enteredAt,
          leftAt: result.leftAt ?? undefined,
          vehicleId: result.vehicleId,
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
              enteredAt: now,
              vehicleId,
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
      setColor('');
      setRateId('');
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
            className="entry-form-plate"
            maxLength={10}
            autoFocus
          />
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
