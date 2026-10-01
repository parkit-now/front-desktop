import { z } from 'zod';
import type { PrinterStorage } from './printerSettings';
import type { TicketTemplateEmphasis } from './ticketTemplate';

const STORAGE_PREFIX = 'parkit.desktop.paymentReceiptTemplate';

export const RECEIPT_TEMPLATE_FIELDS = [
  'parkingName',
  'parkingAddress',
  'parkingCuit',
  'grossIncome',
  'nonFiscalControl',
  'receiptTitle',
  'plate',
  'ticketNumber',
  'entryDateTime',
  'exitDateTime',
  'paymentMethod',
  'amount',
  'received',
  'change',
] as const;

export type ReceiptTemplateFieldId = (typeof RECEIPT_TEMPLATE_FIELDS)[number];

export interface ReceiptTemplateField {
  id: ReceiptTemplateFieldId;
  visible: boolean;
  fontSizePt: number;
  emphasis: TicketTemplateEmphasis;
}

export interface ReceiptTemplateSettings {
  version: 1;
  tenantId: string;
  fields: ReceiptTemplateField[];
  cuitOverride: string;
  grossIncomeText: string;
  nonFiscalControlText: string;
}

export const RECEIPT_TEMPLATE_FIELD_LABELS: Record<
  ReceiptTemplateFieldId,
  string
> = {
  parkingName: 'Nombre del estacionamiento',
  parkingAddress: 'Dirección',
  parkingCuit: 'CUIT',
  grossIncome: 'IIBB',
  nonFiscalControl: 'Control no fiscal',
  receiptTitle: 'Título no fiscal',
  plate: 'Patente',
  ticketNumber: 'Número de ticket',
  entryDateTime: 'Ingreso',
  exitDateTime: 'Egreso',
  paymentMethod: 'Medio de pago',
  amount: 'Monto',
  received: 'Recibido',
  change: 'Vuelto',
};

export const REQUIRED_RECEIPT_FIELDS = [
  'plate',
  'entryDateTime',
  'exitDateTime',
  'amount',
] as const satisfies readonly ReceiptTemplateFieldId[];

const REQUIRED_RECEIPT_FIELD_SET = new Set<ReceiptTemplateFieldId>(
  REQUIRED_RECEIPT_FIELDS,
);

const DEFAULT_FIELDS: ReceiptTemplateField[] = [
  { id: 'parkingName', visible: true, fontSizePt: 10, emphasis: 'bold' },
  { id: 'parkingAddress', visible: true, fontSizePt: 7, emphasis: 'normal' },
  { id: 'parkingCuit', visible: true, fontSizePt: 7, emphasis: 'normal' },
  { id: 'grossIncome', visible: false, fontSizePt: 7, emphasis: 'normal' },
  {
    id: 'nonFiscalControl',
    visible: true,
    fontSizePt: 7,
    emphasis: 'normal',
  },
  { id: 'receiptTitle', visible: true, fontSizePt: 8, emphasis: 'bold' },
  { id: 'plate', visible: true, fontSizePt: 16, emphasis: 'bold' },
  { id: 'ticketNumber', visible: true, fontSizePt: 8, emphasis: 'normal' },
  { id: 'entryDateTime', visible: true, fontSizePt: 9, emphasis: 'normal' },
  { id: 'exitDateTime', visible: true, fontSizePt: 9, emphasis: 'normal' },
  { id: 'paymentMethod', visible: true, fontSizePt: 9, emphasis: 'normal' },
  { id: 'amount', visible: true, fontSizePt: 13, emphasis: 'bold' },
  { id: 'received', visible: true, fontSizePt: 8, emphasis: 'normal' },
  { id: 'change', visible: true, fontSizePt: 8, emphasis: 'normal' },
];

const FieldSchema = z.object({
  id: z.enum(RECEIPT_TEMPLATE_FIELDS),
  visible: z.boolean().optional().catch(undefined),
  fontSizePt: z.number().min(6).max(32).optional().catch(undefined),
  emphasis: z.enum(['normal', 'bold']).optional().catch(undefined),
});

const StoredSchema = z.object({
  tenantId: z.string().min(1).optional().catch(undefined),
  fields: z.array(FieldSchema).optional().catch(undefined),
  cuitOverride: z.string().optional().catch(''),
  grossIncomeText: z.string().optional().catch(''),
  nonFiscalControlText: z.string().optional().catch(''),
});

function getBrowserStorage(): PrinterStorage | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage;
}

function storageKey(tenantId: string): string {
  return `${STORAGE_PREFIX}:${tenantId}`;
}

function cloneDefaultFields(): ReceiptTemplateField[] {
  return DEFAULT_FIELDS.map((field) => ({ ...field }));
}

export function defaultReceiptTemplateSettings(
  tenantId: string,
): ReceiptTemplateSettings {
  return {
    version: 1,
    tenantId,
    fields: cloneDefaultFields(),
    cuitOverride: '',
    grossIncomeText: '',
    nonFiscalControlText: 'No válido como factura',
  };
}

function normalizeFields(
  fields: z.infer<typeof FieldSchema>[] | undefined,
): ReceiptTemplateField[] {
  const defaultsById = new Map(
    cloneDefaultFields().map((field) => [field.id, field]),
  );
  const seen = new Set<ReceiptTemplateFieldId>();
  const normalized: ReceiptTemplateField[] = [];

  for (const field of fields ?? []) {
    if (seen.has(field.id)) continue;
    const defaults = defaultsById.get(field.id);
    if (!defaults) continue;
    seen.add(field.id);
    normalized.push({
      ...defaults,
      visible: REQUIRED_RECEIPT_FIELD_SET.has(field.id)
        ? true
        : (field.visible ?? defaults.visible),
      fontSizePt: field.fontSizePt ?? defaults.fontSizePt,
      emphasis: field.emphasis ?? defaults.emphasis,
    });
  }

  for (const defaults of defaultsById.values()) {
    if (!seen.has(defaults.id)) normalized.push({ ...defaults });
  }

  return normalized;
}

export function normalizeReceiptTemplateSettings(
  tenantId: string | null | undefined,
  value: unknown,
): ReceiptTemplateSettings {
  const safeTenantId = tenantId?.trim() || 'default';
  const defaults = defaultReceiptTemplateSettings(safeTenantId);
  const parsed = StoredSchema.safeParse(value);
  if (!parsed.success) return defaults;
  return {
    version: 1,
    tenantId: safeTenantId,
    fields: normalizeFields(parsed.data.fields),
    cuitOverride: parsed.data.cuitOverride ?? '',
    grossIncomeText: parsed.data.grossIncomeText ?? '',
    nonFiscalControlText:
      parsed.data.nonFiscalControlText ?? defaults.nonFiscalControlText,
  };
}

export function readReceiptTemplateSettings(
  tenantId: string | null | undefined,
  storage: PrinterStorage | null = getBrowserStorage(),
): ReceiptTemplateSettings {
  const safeTenantId = tenantId?.trim() || 'default';
  const defaults = defaultReceiptTemplateSettings(safeTenantId);
  if (!storage) return defaults;

  const raw = storage.getItem(storageKey(safeTenantId));
  if (!raw) return defaults;

  try {
    return normalizeReceiptTemplateSettings(safeTenantId, JSON.parse(raw));
  } catch {
    return defaults;
  }
}

export function writeReceiptTemplateSettings(
  next: ReceiptTemplateSettings,
  storage: PrinterStorage | null = getBrowserStorage(),
): void {
  if (!storage) return;
  storage.setItem(storageKey(next.tenantId), JSON.stringify(next));
}

export function resetReceiptTemplateSettings(
  tenantId: string | null | undefined,
  storage: PrinterStorage | null = getBrowserStorage(),
): ReceiptTemplateSettings {
  const next = defaultReceiptTemplateSettings(tenantId?.trim() || 'default');
  writeReceiptTemplateSettings(next, storage);
  return next;
}

export function isRequiredReceiptField(
  fieldId: ReceiptTemplateFieldId,
): boolean {
  return REQUIRED_RECEIPT_FIELD_SET.has(fieldId);
}
