import type {
  LocalCashSession,
  LocalEntry,
  LocalInvoice,
  LocalPaymentTransaction,
  PendingOp,
} from '../../lib/db/localDb';

export function entryDeletionBlockers(input: {
  entry: LocalEntry;
  invoice?: LocalInvoice | null;
  payments: LocalPaymentTransaction[];
  sessions: LocalCashSession[];
  pendingOps: PendingOp[];
  isOnline: boolean;
}): string[] {
  const { entry, invoice, payments, sessions, pendingOps, isOnline } = input;
  const reasons: string[] = [];
  if (!isOnline) reasons.push('Se necesita conexión para eliminar el ingreso.');
  if (
    pendingOps.some(
      (op) => op.entityType === 'entry' && op.entityId === entry.id,
    )
  ) {
    reasons.push('Este ingreso tiene cambios pendientes de sincronización.');
  }
  if (entry.reservationId) reasons.push('Está vinculado con una reserva.');
  if (
    entry.manuallyInvoiced ||
    invoice?.status === 'issued' ||
    invoice?.status === 'issuing' ||
    invoice?.cbteNro != null
  ) {
    reasons.push('Tiene una factura emitida o en curso.');
  }
  if (
    payments.some(
      (payment) =>
        !payment.deletedAt && payment.paymentMethodType === 'mercadopago_qr',
    )
  ) {
    reasons.push('Tiene un cobro QR de Mercado Pago.');
  }
  const sessionIds = new Set(
    [
      entry.cashSessionId,
      ...payments
        .filter((payment) => !payment.deletedAt)
        .map((payment) => payment.cashSessionId),
    ].filter((id): id is string => Boolean(id)),
  );
  if (
    !entry.cashSessionId ||
    [...sessionIds].some((id) => {
      const session = sessions.find((item) => item.id === id);
      return !session || Boolean(session.closedAt);
    })
  ) {
    reasons.push('La caja asociada está cerrada o no está disponible.');
  }
  return reasons;
}
