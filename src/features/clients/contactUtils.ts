import type { LocalClient } from '../../lib/db/localDb';
import { normalizeClientPlate } from './clientUtils';

export function clientForInvoice(
  rows: LocalClient[],
  plate: string,
  receiverCuit?: string | null,
): LocalClient | null {
  const active = rows.filter((row) => !row.deletedAt);
  if (receiverCuit)
    return active.find((row) => row.cuit === receiverCuit) ?? null;
  const normalized = normalizeClientPlate(plate);
  return active.find((row) => row.plates.includes(normalized)) ?? null;
}

export function whatsappUrl(phone: string | null): string | null {
  const normalized = phone?.replace(/[\s()-]/g, '') ?? '';
  return /^\+[1-9]\d{7,14}$/.test(normalized)
    ? `https://wa.me/${normalized.slice(1)}`
    : null;
}
