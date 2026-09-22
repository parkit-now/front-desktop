import { z } from 'zod';
import type { PrinterStorage } from './printerSettings';

const STORAGE_PREFIX = 'parkit.desktop.ticketTemplate';

export const TICKET_TEMPLATE_FIELDS = [
  'parkingName',
  'parkingAddress',
  'parkingCuit',
  'grossIncome',
  'nonFiscalControl',
  'ticketNumber',
  'plate',
  'vehicleBrand',
  'vehicleModel',
  'color',
  'rate',
  'entryDate',
  'entryTime',
  'cochera',
  'notes',
] as const;

export type TicketTemplateFieldId = (typeof TICKET_TEMPLATE_FIELDS)[number];
export type TicketTemplateFontSize = 'small' | 'normal' | 'large' | 'hero';
export type TicketTemplateEmphasis = 'normal' | 'bold';

export interface TicketTemplateField {
  id: TicketTemplateFieldId;
  visible: boolean;
  fontSizePt: number;
  emphasis: TicketTemplateEmphasis;
}

export interface TicketTemplateSettings {
  version: 1;
  tenantId: string;
  fields: TicketTemplateField[];
  cuitOverride: string;
  grossIncomeText: string;
  nonFiscalControlText: string;
}

export const TICKET_TEMPLATE_FIELD_LABELS: Record<
  TicketTemplateFieldId,
  string
> = {
  parkingName: 'Nombre del estacionamiento',
  parkingAddress: 'Dirección',
  parkingCuit: 'CUIT',
  grossIncome: 'IIBB',
  nonFiscalControl: 'Control no fiscal',
  ticketNumber: 'Número de ticket',
  plate: 'Patente',
  vehicleBrand: 'Marca',
  vehicleModel: 'Modelo',
  color: 'Color',
  rate: 'Tarifa',
  entryDate: 'Fecha de ingreso',
  entryTime: 'Hora de ingreso',
  cochera: 'Cochera',
  notes: 'Observaciones',
};

export const TICKET_TEMPLATE_SIZE_OPTIONS: Record<
  TicketTemplateFontSize,
  { label: string; pt: number }
> = {
  small: { label: 'Chico', pt: 8 },
  normal: { label: 'Normal', pt: 10 },
  large: { label: 'Grande', pt: 13 },
  hero: { label: 'Destacado', pt: 24 },
};

const DEFAULT_FIELDS: TicketTemplateField[] = [
  { id: 'parkingName', visible: true, fontSizePt: 11, emphasis: 'bold' },
  { id: 'parkingAddress', visible: true, fontSizePt: 8, emphasis: 'normal' },
  { id: 'parkingCuit', visible: true, fontSizePt: 8, emphasis: 'normal' },
  { id: 'grossIncome', visible: true, fontSizePt: 8, emphasis: 'normal' },
  {
    id: 'nonFiscalControl',
    visible: true,
    fontSizePt: 8,
    emphasis: 'normal',
  },
  { id: 'ticketNumber', visible: true, fontSizePt: 24, emphasis: 'bold' },
  { id: 'plate', visible: true, fontSizePt: 13, emphasis: 'bold' },
  { id: 'vehicleBrand', visible: true, fontSizePt: 9, emphasis: 'normal' },
  { id: 'vehicleModel', visible: true, fontSizePt: 9, emphasis: 'normal' },
  { id: 'color', visible: true, fontSizePt: 9, emphasis: 'normal' },
  { id: 'rate', visible: true, fontSizePt: 9, emphasis: 'normal' },
  { id: 'entryDate', visible: true, fontSizePt: 9, emphasis: 'normal' },
  { id: 'entryTime', visible: true, fontSizePt: 9, emphasis: 'bold' },
  { id: 'cochera', visible: false, fontSizePt: 9, emphasis: 'normal' },
  { id: 'notes', visible: false, fontSizePt: 8, emphasis: 'normal' },
];

const FieldSchema = z.object({
  id: z.enum(TICKET_TEMPLATE_FIELDS),
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

function cloneDefaultFields(): TicketTemplateField[] {
  return DEFAULT_FIELDS.map((field) => ({ ...field }));
}

export function defaultTicketTemplateSettings(
  tenantId: string,
): TicketTemplateSettings {
  return {
    version: 1,
    tenantId,
    fields: cloneDefaultFields(),
    cuitOverride: '',
    grossIncomeText: '',
    nonFiscalControlText: 'Control no fiscal',
  };
}

function normalizeFields(
  fields: z.infer<typeof FieldSchema>[] | undefined,
): TicketTemplateField[] {
  const defaultsById = new Map(
    cloneDefaultFields().map((field) => [field.id, field]),
  );
  const seen = new Set<TicketTemplateFieldId>();
  const normalized: TicketTemplateField[] = [];

  for (const field of fields ?? []) {
    if (seen.has(field.id)) continue;
    const defaults = defaultsById.get(field.id);
    if (!defaults) continue;
    seen.add(field.id);
    normalized.push({
      ...defaults,
      visible: field.visible ?? defaults.visible,
      fontSizePt: field.fontSizePt ?? defaults.fontSizePt,
      emphasis: field.emphasis ?? defaults.emphasis,
    });
  }

  for (const defaults of defaultsById.values()) {
    if (!seen.has(defaults.id)) normalized.push({ ...defaults });
  }

  return normalized;
}

export function readTicketTemplateSettings(
  tenantId: string | null | undefined,
  storage: PrinterStorage | null = getBrowserStorage(),
): TicketTemplateSettings {
  const safeTenantId = tenantId?.trim() || 'default';
  const defaults = defaultTicketTemplateSettings(safeTenantId);
  if (!storage) return defaults;

  const raw = storage.getItem(storageKey(safeTenantId));
  if (!raw) return defaults;

  try {
    return normalizeTicketTemplateSettings(safeTenantId, JSON.parse(raw));
  } catch {
    return defaults;
  }
}

export function normalizeTicketTemplateSettings(
  tenantId: string | null | undefined,
  value: unknown,
): TicketTemplateSettings {
  const safeTenantId = tenantId?.trim() || 'default';
  const defaults = defaultTicketTemplateSettings(safeTenantId);
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

export function ticketTemplatePayload(next: TicketTemplateSettings) {
  return {
    version: 1,
    fields: next.fields,
    cuitOverride: next.cuitOverride,
    grossIncomeText: next.grossIncomeText,
    nonFiscalControlText: next.nonFiscalControlText,
  } as const;
}

export function writeTicketTemplateSettings(
  next: TicketTemplateSettings,
  storage: PrinterStorage | null = getBrowserStorage(),
): void {
  if (!storage) return;
  storage.setItem(storageKey(next.tenantId), JSON.stringify(next));
}

export function resetTicketTemplateSettings(
  tenantId: string | null | undefined,
  storage: PrinterStorage | null = getBrowserStorage(),
): TicketTemplateSettings {
  const next = defaultTicketTemplateSettings(tenantId?.trim() || 'default');
  writeTicketTemplateSettings(next, storage);
  return next;
}

export function fontSizeToOption(fontSizePt: number): TicketTemplateFontSize {
  const entries = Object.entries(TICKET_TEMPLATE_SIZE_OPTIONS) as Array<
    [TicketTemplateFontSize, { label: string; pt: number }]
  >;
  return entries.reduce<TicketTemplateFontSize>((closest, [key, value]) => {
    const currentDistance = Math.abs(
      TICKET_TEMPLATE_SIZE_OPTIONS[closest].pt - fontSizePt,
    );
    const nextDistance = Math.abs(value.pt - fontSizePt);
    return nextDistance < currentDistance ? key : closest;
  }, 'normal');
}
