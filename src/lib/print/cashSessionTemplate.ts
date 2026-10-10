import { z } from 'zod';
import type { PrinterStorage } from './printerSettings';
import type { TicketTemplateEmphasis } from './ticketTemplate';

const STORAGE_PREFIX = 'parkit.desktop.cashSessionTemplate';

export const CASH_SESSION_TEMPLATE_FIELDS = [
  'parkingName',
  'title',
  'openedAt',
  'closedAt',
  'paymentMethods',
  'grandTotal',
  'transactionCount',
  'openingCash',
  'cashTotal',
  'leavingCash',
  'notes',
] as const;

export type CashSessionTemplateFieldId =
  (typeof CASH_SESSION_TEMPLATE_FIELDS)[number];

export interface CashSessionTemplateField {
  id: CashSessionTemplateFieldId;
  visible: boolean;
  fontSizePt: number;
  emphasis: TicketTemplateEmphasis;
}

export interface CashSessionTemplateSettings {
  version: 1;
  tenantId: string;
  fields: CashSessionTemplateField[];
}

export const CASH_SESSION_TEMPLATE_FIELD_LABELS: Record<
  CashSessionTemplateFieldId,
  string
> = {
  parkingName: 'Nombre del estacionamiento',
  title: 'Título del cierre',
  openedAt: 'Apertura',
  closedAt: 'Cierre',
  paymentMethods: 'Desglose por medio de pago',
  grandTotal: 'Total cobrado',
  transactionCount: 'Cantidad de pagos',
  openingCash: 'Fondo inicial',
  cashTotal: 'Efectivo en caja',
  leavingCash: 'Fondo para el siguiente turno',
  notes: 'Notas',
};

const REQUIRED_FIELDS = new Set<CashSessionTemplateFieldId>([
  'title',
  'openedAt',
  'closedAt',
  'grandTotal',
]);

const DEFAULT_FIELDS: CashSessionTemplateField[] = [
  { id: 'parkingName', visible: true, fontSizePt: 10, emphasis: 'bold' },
  { id: 'title', visible: true, fontSizePt: 13, emphasis: 'bold' },
  { id: 'openedAt', visible: true, fontSizePt: 9, emphasis: 'normal' },
  { id: 'closedAt', visible: true, fontSizePt: 9, emphasis: 'normal' },
  { id: 'paymentMethods', visible: true, fontSizePt: 9, emphasis: 'normal' },
  { id: 'grandTotal', visible: true, fontSizePt: 11, emphasis: 'bold' },
  { id: 'transactionCount', visible: false, fontSizePt: 9, emphasis: 'normal' },
  { id: 'openingCash', visible: true, fontSizePt: 9, emphasis: 'normal' },
  { id: 'cashTotal', visible: true, fontSizePt: 9, emphasis: 'normal' },
  { id: 'leavingCash', visible: true, fontSizePt: 9, emphasis: 'normal' },
  { id: 'notes', visible: true, fontSizePt: 9, emphasis: 'normal' },
];

const FieldSchema = z.object({
  id: z.enum(CASH_SESSION_TEMPLATE_FIELDS),
  visible: z.boolean().optional().catch(undefined),
  fontSizePt: z.number().min(6).max(32).optional().catch(undefined),
  emphasis: z.enum(['normal', 'bold']).optional().catch(undefined),
});

const StoredSchema = z.object({
  fields: z.array(FieldSchema).optional().catch(undefined),
});

function getBrowserStorage(): PrinterStorage | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage;
}

function safeTenantId(tenantId: string | null | undefined): string {
  return tenantId?.trim() || 'default';
}

export function defaultCashSessionTemplateSettings(
  tenantId: string | null | undefined,
): CashSessionTemplateSettings {
  return {
    version: 1,
    tenantId: safeTenantId(tenantId),
    fields: DEFAULT_FIELDS.map((field) => ({ ...field })),
  };
}

export function normalizeCashSessionTemplateSettings(
  tenantId: string | null | undefined,
  value: unknown,
): CashSessionTemplateSettings {
  const defaults = defaultCashSessionTemplateSettings(tenantId);
  const parsed = StoredSchema.safeParse(value);
  if (!parsed.success) return defaults;

  const defaultsById = new Map(
    defaults.fields.map((field) => [field.id, field]),
  );
  const seen = new Set<CashSessionTemplateFieldId>();
  const fields: CashSessionTemplateField[] = [];
  for (const saved of parsed.data.fields ?? []) {
    if (seen.has(saved.id)) continue;
    const field = defaultsById.get(saved.id);
    if (!field) continue;
    seen.add(saved.id);
    fields.push({
      ...field,
      visible: REQUIRED_FIELDS.has(saved.id)
        ? true
        : (saved.visible ?? field.visible),
      fontSizePt: saved.fontSizePt ?? field.fontSizePt,
      emphasis: saved.emphasis ?? field.emphasis,
    });
  }
  for (const field of defaults.fields) {
    if (!seen.has(field.id)) fields.push(field);
  }
  return { ...defaults, fields };
}

export function readCashSessionTemplateSettings(
  tenantId: string | null | undefined,
  storage: PrinterStorage | null = getBrowserStorage(),
): CashSessionTemplateSettings {
  const safeId = safeTenantId(tenantId);
  if (!storage) return defaultCashSessionTemplateSettings(safeId);
  const raw = storage.getItem(`${STORAGE_PREFIX}:${safeId}`);
  if (!raw) return defaultCashSessionTemplateSettings(safeId);
  try {
    return normalizeCashSessionTemplateSettings(safeId, JSON.parse(raw));
  } catch {
    return defaultCashSessionTemplateSettings(safeId);
  }
}

export function writeCashSessionTemplateSettings(
  next: CashSessionTemplateSettings,
  storage: PrinterStorage | null = getBrowserStorage(),
): void {
  if (!storage) return;
  storage.setItem(`${STORAGE_PREFIX}:${next.tenantId}`, JSON.stringify(next));
}

export function resetCashSessionTemplateSettings(
  tenantId: string | null | undefined,
  storage: PrinterStorage | null = getBrowserStorage(),
): CashSessionTemplateSettings {
  const next = defaultCashSessionTemplateSettings(tenantId);
  writeCashSessionTemplateSettings(next, storage);
  return next;
}

export function isRequiredCashSessionField(
  fieldId: CashSessionTemplateFieldId,
): boolean {
  return REQUIRED_FIELDS.has(fieldId);
}
