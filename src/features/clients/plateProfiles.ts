import {
  localDb,
  type LocalEntry,
  type LocalPlateProfile,
  type LocalRate,
  type LocalVehicle,
  type LocalVehicleType,
} from '../../lib/db/localDb';
import type { PlateProfileDto } from '../../lib/api/plate-profiles';
import { COLORS } from '../../lib/data/colors';
import { normalizeClientPlate } from './clientUtils';

export const plateProfileKey = (tenantId: string, plate: string) =>
  `${tenantId}:${normalizeClientPlate(plate)}`;
export const profileToLocal = (
  profile: PlateProfileDto,
): LocalPlateProfile => ({
  ...profile,
  key: plateProfileKey(profile.tenantId, profile.plate),
});

export function emptyPlateProfile(
  tenantId: string,
  plate: string,
): LocalPlateProfile {
  const now = new Date().toISOString();
  return {
    key: plateProfileKey(tenantId, plate),
    tenantId,
    plate: normalizeClientPlate(plate),
    vehicleBrand: null,
    vehicleModel: null,
    vehicleTypeId: null,
    vehicleTypeName: null,
    color: null,
    rateId: null,
    rateName: null,
    lastEntryId: null,
    lastEnteredAt: null,
    learnAfter: null,
    editVersion: 0,
    version: 0,
    syncSeq: 0,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

// Mirrors the database trigger. Never called while merely reading history.
export function projectPlateProfile(
  current: LocalPlateProfile | undefined,
  entry: LocalEntry,
  previous?: LocalEntry,
): LocalPlateProfile | undefined {
  if (entry.deletedAt) return current;
  const enteredAt = Date.parse(entry.enteredAt);
  const plate = normalizeClientPlate(entry.plate);
  if (
    previous &&
    (current?.deletedAt || (!current && previous.plate === entry.plate))
  )
    return current;
  if (
    current?.deletedAt &&
    enteredAt <= Date.parse(current.learnAfter ?? current.deletedAt)
  )
    return current;
  if (
    current?.lastEnteredAt &&
    !previous &&
    (enteredAt < Date.parse(current.lastEnteredAt) ||
      (enteredAt === Date.parse(current.lastEnteredAt) &&
        entry.id < (current.lastEntryId ?? '')))
  )
    return current;
  if (
    !previous &&
    current?.learnAfter &&
    enteredAt <= Date.parse(current.learnAfter)
  )
    return current;
  const newVisit = !previous || previous.plate !== entry.plate;
  const brandChanged =
    newVisit ||
    entry.vehicleBrand !== previous.vehicleBrand ||
    entry.vehicleModel !== previous.vehicleModel;
  const typeChanged =
    newVisit || entry.vehicleTypeId !== previous.vehicleTypeId;
  const colorChanged = newVisit || entry.color !== previous.color;
  const rateChanged = newVisit || entry.rateId !== previous.rateId;
  if (
    !(
      brandChanged ||
      typeChanged ||
      colorChanged ||
      rateChanged ||
      (previous && entry.plate !== previous.plate)
    )
  )
    return current;
  return {
    ...(current ?? emptyPlateProfile(entry.tenantId, plate)),
    ...(brandChanged && {
      vehicleBrand: entry.vehicleBrand || null,
      vehicleModel: entry.vehicleModel || null,
    }),
    ...(typeChanged && {
      vehicleTypeId: entry.vehicleTypeId ?? null,
      vehicleTypeName: entry.vehicleType ?? null,
    }),
    ...(colorChanged && { color: entry.color || null }),
    ...(rateChanged && {
      rateId: entry.rateId ?? null,
      rateName: entry.rateSnapshotName ?? null,
    }),
    lastEntryId: entry.id,
    lastEnteredAt: entry.enteredAt,
    deletedAt: null,
    updatedAt: entry.updatedAt,
  };
}

export async function learnLocalPlateProfile(
  entry: LocalEntry,
  previous?: LocalEntry,
) {
  const key = plateProfileKey(entry.tenantId, entry.plate);
  await localDb.transaction(
    'rw',
    localDb.plateProfiles,
    localDb.entries,
    async () => {
      const current = await localDb.plateProfiles.get(key);
      const next = projectPlateProfile(current, entry, previous);
      if (previous && next !== current) {
        const newer = await localDb.entries
          .where('tenantId')
          .equals(entry.tenantId)
          .filter(
            (row) =>
              !row.deletedAt &&
              normalizeClientPlate(row.plate) ===
                normalizeClientPlate(entry.plate) &&
              (Date.parse(row.enteredAt) > Date.parse(entry.enteredAt) ||
                (Date.parse(row.enteredAt) === Date.parse(entry.enteredAt) &&
                  row.id > entry.id)),
          )
          .first();
        if (newer) return;
      }
      if (next && next !== current) await localDb.plateProfiles.put(next);
    },
  );
}

export function resolvePlateProfile(
  profile: LocalPlateProfile | undefined,
  options: {
    vehicles: LocalVehicle[];
    types: LocalVehicleType[];
    rates: LocalRate[];
  },
) {
  if (!profile || profile.deletedAt) return {};
  const equal = (a: string | null | undefined, b: string | null | undefined) =>
    (a ?? '').trim().toLocaleLowerCase() ===
    (b ?? '').trim().toLocaleLowerCase();
  return {
    vehicle: options.vehicles.find(
      (v) =>
        !v.deletedAt &&
        equal(v.brand, profile.vehicleBrand) &&
        equal(v.model, profile.vehicleModel),
    ),
    type: options.types.find(
      (t) => !t.deletedAt && t.id === profile.vehicleTypeId,
    ),
    rate: options.rates.find(
      (r) => !r.deletedAt && r.isActive && r.id === profile.rateId,
    ),
    color: COLORS.find((c) => equal(c, profile.color)),
  };
}
