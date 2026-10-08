import type { AuditEvent } from '../../lib/api/reports';
import { arDay, dateTime, money } from './reportUtils';

export type AuditKind =
  | 'entry.corrected'
  | 'entry.deleted'
  | 'entry.undercharged'
  | 'invoice.cert_expired'
  | 'other';
export type AuditRow = {
  id: string;
  createdAt: string;
  date: string;
  severity: AuditEvent['severity'];
  action: string;
  kind: AuditKind;
  label: string;
  actor: string;
  actorRole: string;
  origin: string;
  plate: string;
  ticket: string;
  cashSessionId: string;
  enteredAt: string;
  leftAt: string;
  vehicleBrand: string;
  vehicleModel: string;
  color: string;
  paymentMethod: string;
  rate: string;
  summary: string;
  impact: number | null;
  reason: string;
  searchText: string;
  metadata: Record<string, unknown>;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  changedFields: string[];
};

const fieldLabels: Record<string, string> = {
  plate: 'Patente',
  color: 'Color',
  cochera: 'Cochera',
  notes: 'Notas',
  enteredAt: 'Ingreso',
  leftAt: 'Egreso',
  amountPaid: 'Total cobrado',
  vehicleBrand: 'Marca',
  vehicleModel: 'Modelo',
  rateId: 'Tarifa',
  rateSnapshotName: 'Tarifa',
  rateSnapshotHourPriceArs: 'Precio por hora',
  rateSnapshotStayPriceArs: 'Precio de estadía',
  rateSnapshotFractionPriceArs: 'Precio de fracción',
  payments: 'Pagos',
};

export function auditFieldLabel(field: string) {
  return fieldLabels[field] ?? field;
}

const labels: Record<string, string> = {
  'entry.corrected': 'Corrección de estadía',
  'entry.deleted': 'Ingreso eliminado',
  'entry.undercharged': 'Cobro menor al sugerido',
  'invoice.cert_expired': 'Cobro sin factura',
  'arca_account.certificate_expired': 'Certificado de ARCA vencido',
  'arca_account.renewal_prepared': 'Renovación de ARCA pendiente',
  'mp_account.link_failed': 'Falló la vinculación de Mercado Pago',
  'mp_account.token_expired': 'Token de Mercado Pago vencido',
  'payment_intent.cancel_mp_failed': 'No se pudo cancelar una orden',
  'payment_intent.refunded': 'Pago devuelto',
  'entry.reservation_unlinked': 'Reserva desvinculada',
  'reservation.accepted': 'Reserva aceptada',
  'reservation.rejected': 'Reserva rechazada',
  'reservation.cancelled': 'Reserva cancelada',
  'reservation.refund_retried': 'Reembolso reintentado',
  'reservation.refund_confirmed': 'Reembolso confirmado',
  'reservation.refund_failed': 'Reembolso fallido',
  'reservation.late_payment_refunded': 'Pago tardío reembolsado',
};
const knownActions = new Set([
  'application.created',
  'application.updated',
  'application.submitted',
  'application.document_added',
  'application.rejected',
  'user.promoted_to_owner',
  'entity.approved',
  'entity.rejected',
  'entity.profile_updated',
  'payment_method.toggled',
  'rate.prices_propagated',
  'parking.created',
  'parking.updated',
  'parking.deleted',
  'user.role_updated',
  'user.deleted',
  'membership.created',
  'membership.updated',
  'membership.deleted',
  'lpr_event.registered',
  'lpr_event.dismissed',
  'lpr_event.suppressed',
  'lpr_event.archived',
  'lpr_event.unarchived',
  'lpr_event.image_purged',
  'mp_account.linked',
  'mp_account.unlinked',
  'mp_account.token_refreshed',
  'arca_account.linked',
  'arca_account.unlinked',
  'arca_account.certificate_renewed',
  ...Object.keys(labels),
]);

export function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
export function stringValue(value: unknown): string {
  return typeof value === 'string'
    ? value
    : typeof value === 'number'
      ? String(value)
      : '';
}
function amount(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}
export function visibleAuditEvent(event: AuditEvent): boolean {
  if (
    event.action.startsWith('lpr_event.') ||
    event.action === 'rate.prices_propagated'
  )
    return false;
  if (event.action === 'entry.corrected') {
    const fields = stringArray(record(event.metadata).changedFields);
    if (
      fields.length > 0 &&
      fields.every((field) => field === 'notes' || field === 'color')
    )
      return false;
  }
  return Boolean(labels[event.action]) || !knownActions.has(event.action);
}
export function toAuditRow(event: AuditEvent): AuditRow {
  const metadata = record(event.metadata);
  const before = record(metadata.before);
  const after = record(metadata.after);
  const kind: AuditKind =
    event.action === 'entry.corrected' ||
    event.action === 'entry.deleted' ||
    event.action === 'entry.undercharged' ||
    event.action === 'invoice.cert_expired'
      ? event.action
      : 'other';
  const plate =
    stringValue(
      after.plate || before.plate || metadata.plate || metadata.vehiclePlate,
    ) || '-';
  const ticket =
    stringValue(
      after.ticketNumber ?? before.ticketNumber ?? metadata.ticketNumber,
    ) || '-';
  const impactData = record(metadata.economicImpact);
  const impact =
    kind === 'entry.undercharged'
      ? amount(metadata.delta)
      : kind === 'entry.deleted'
        ? amount(metadata.amountPaid)
        : (amount(impactData.chargedDelta) ??
          (amount(after.amountPaid) !== null &&
          amount(before.amountPaid) !== null
            ? (amount(after.amountPaid) ?? 0) - (amount(before.amountPaid) ?? 0)
            : null));
  const changedFields = stringArray(metadata.changedFields);
  const origin =
    stringValue(metadata.origin) ||
    (kind === 'entry.deleted' ? 'desktop' : 'unknown');
  const reason = stringValue(metadata.reason) || '-';
  const label = labels[event.action] ?? 'Evento del sistema';
  const summary =
    kind === 'entry.deleted'
      ? `Ingreso ${plate} eliminado`
      : kind === 'entry.corrected'
        ? `Se corrigió ${plate}${changedFields.length ? `: ${[...new Set(changedFields.map(auditFieldLabel))].join(', ')}` : ''}`
        : kind === 'entry.undercharged'
          ? `Cobro menor al sugerido en ${plate}`
          : kind === 'invoice.cert_expired'
            ? `Factura pendiente por certificado vencido`
            : label;
  const actorRole =
    stringValue(metadata.actorRole) ||
    (kind === 'entry.deleted' ? 'owner' : '-');
  const cashSessionId =
    stringValue(
      after.cashSessionId || before.cashSessionId || metadata.cashSessionId,
    ) || '-';
  const enteredAt = stringValue(after.enteredAt || before.enteredAt);
  const leftAt = stringValue(after.leftAt || before.leftAt);
  const vehicleBrand = stringValue(after.vehicleBrand || before.vehicleBrand);
  const vehicleModel = stringValue(after.vehicleModel || before.vehicleModel);
  const color = stringValue(after.color || before.color);
  const rate = stringValue(after.rateSnapshotName || before.rateSnapshotName);
  const payments = Array.isArray(after.payments)
    ? after.payments
    : Array.isArray(before.payments)
      ? before.payments
      : [];
  const paymentMethod = payments
    .map((item) => stringValue(record(item).paymentMethodName))
    .filter(Boolean)
    .join(', ');
  return {
    id: event.id,
    createdAt: event.createdAt,
    date: arDay(new Date(event.createdAt)),
    severity: event.severity,
    action: event.action,
    kind,
    label,
    actor: event.actorName ?? 'Sistema',
    actorRole,
    origin,
    plate,
    ticket,
    cashSessionId,
    enteredAt,
    leftAt,
    vehicleBrand,
    vehicleModel,
    color,
    paymentMethod,
    rate,
    summary,
    impact,
    reason,
    metadata,
    before,
    after,
    changedFields,
    searchText: [
      plate,
      ticket,
      event.actorName,
      actorRole,
      label,
      reason,
      origin,
      changedFields.join(' '),
      vehicleBrand,
      vehicleModel,
      color,
      paymentMethod,
      rate,
    ]
      .filter(Boolean)
      .join(' '),
  };
}
export function riskTotals(rows: AuditRow[], suspiciousDismissals: number) {
  const undercharged = rows
    .filter((row) => row.kind === 'entry.undercharged')
    .reduce((sum, row) => sum + Math.max(0, row.impact ?? 0), 0);
  const reductions = rows
    .filter((row) => row.kind === 'entry.corrected')
    .reduce((sum, row) => sum + Math.max(0, -(row.impact ?? 0)), 0);
  const suggestedReductionRisk = rows
    .filter((row) => row.kind === 'entry.corrected')
    .reduce((sum, row) => {
      const delta = record(row.metadata.economicImpact).suggestedDelta;
      return (
        sum +
        (typeof delta === 'number' && Number.isFinite(delta) && delta < -0.005
          ? -delta
          : 0)
      );
    }, 0);
  return {
    alerts: rows.filter((row) => row.severity !== 'info').length,
    possibleLoss: undercharged + reductions,
    undercharged,
    reductions,
    suggestedReductionRisk,
    suspiciousDismissals,
  };
}
export function metadataLines(
  row: AuditRow,
): { label: string; value: string }[] {
  if (row.kind !== 'other') return [];
  const readable: Record<string, string> = {
    amount: 'Importe',
    archivedAt: 'Archivado',
    chargedAmount: 'Cobrado',
    confidence: 'Confianza',
    delta: 'Diferencia',
    error: 'Error',
    expiresAt: 'Vencimiento',
    invoiceId: 'Factura',
    normalizedText: 'Patente normalizada',
    orderId: 'Orden Mercado Pago',
    paymentIntentId: 'Intento de pago',
    qualityStatus: 'Calidad',
    reason: 'Razón',
    refundArs: 'Reembolso',
    renewalDueAt: 'Renovar antes de',
    reservationCode: 'Reserva',
    status: 'Estado',
    suggestedAmount: 'Sugerido',
  };
  return Object.entries(row.metadata)
    .filter(
      ([key]) =>
        ![
          'before',
          'after',
          'plate',
          'vehiclePlate',
          'ticketNumber',
          'actorRole',
          'origin',
          'cashSessionId',
        ].includes(key),
    )
    .map(([key, value]) => ({
      label: readable[key] ?? key,
      value:
        value === null || value === undefined
          ? '-'
          : typeof value === 'number' && key === 'confidence'
            ? `${Math.round(value * 100)}%`
            : typeof value === 'number' && /amount|delta|refund|ars/i.test(key)
              ? money(value)
              : typeof value === 'object'
                ? JSON.stringify(value, null, 2)
                : typeof value === 'string'
                  ? /At$|Date|DueAt/.test(key) &&
                    Number.isFinite(new Date(value).getTime())
                    ? dateTime(value)
                    : value.replaceAll('_', ' ')
                  : typeof value === 'boolean'
                    ? value
                      ? 'Sí'
                      : 'No'
                    : typeof value === 'number'
                      ? String(value)
                      : '-',
    }));
}
