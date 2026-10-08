import { describe, expect, it } from 'vitest';
import type {
  LocalCashSession,
  LocalEntry,
  LocalInvoice,
  LocalPaymentTransaction,
  PendingOp,
} from '../../lib/db/localDb';
import { entryDeletionBlockers } from './entryDeletion';

const entry = {
  id: 'entry-1',
  cashSessionId: 'session-1',
  version: 2,
} as LocalEntry;
const session = { id: 'session-1', closedAt: undefined } as LocalCashSession;

function reasons(
  overrides: Partial<Parameters<typeof entryDeletionBlockers>[0]> = {},
) {
  return entryDeletionBlockers({
    entry,
    invoice: null,
    payments: [],
    sessions: [session],
    pendingOps: [],
    isOnline: true,
    ...overrides,
  });
}

describe('entryDeletionBlockers', () => {
  it('permite un ingreso sin cobro con caja abierta', () => {
    expect(reasons()).toEqual([]);
  });

  it('bloquea falta de conexión y cambios pendientes', () => {
    const pending = { entityType: 'entry', entityId: entry.id } as PendingOp;
    expect(reasons({ isOnline: false, pendingOps: [pending] })).toEqual([
      'Se necesita conexión para eliminar el ingreso.',
      'Este ingreso tiene cambios pendientes de sincronización.',
    ]);
  });

  it('bloquea facturas emitidas, en curso o marcadas manualmente', () => {
    expect(reasons({ entry: { ...entry, manuallyInvoiced: true } })).toContain(
      'Tiene una factura emitida o en curso.',
    );
    expect(
      reasons({ invoice: { status: 'issued' } as LocalInvoice }),
    ).toContain('Tiene una factura emitida o en curso.');
    expect(
      reasons({ invoice: { status: 'issuing' } as LocalInvoice }),
    ).toContain('Tiene una factura emitida o en curso.');
    expect(
      reasons({ invoice: { status: 'error', cbteNro: 5 } as LocalInvoice }),
    ).toContain('Tiene una factura emitida o en curso.');
    expect(reasons({ invoice: { status: 'pending' } as LocalInvoice })).toEqual(
      [],
    );
    expect(reasons({ invoice: { status: 'error' } as LocalInvoice })).toEqual(
      [],
    );
    expect(
      reasons({ invoice: { status: 'not_required' } as LocalInvoice }),
    ).toEqual([]);
  });

  it('bloquea reservas, QR y cajas cerradas incluso para pagos divididos', () => {
    const qr = {
      paymentMethodType: 'mercadopago_qr',
      cashSessionId: 'session-2',
    } as LocalPaymentTransaction;
    expect(
      reasons({ entry: { ...entry, reservationId: 'reservation-1' } }),
    ).toContain('Está vinculado con una reserva.');
    expect(
      reasons({
        payments: [qr],
        sessions: [
          session,
          { id: 'session-2', closedAt: '2026-10-07' } as LocalCashSession,
        ],
      }),
    ).toEqual([
      'Tiene un cobro QR de Mercado Pago.',
      'La caja asociada está cerrada o no está disponible.',
    ]);
  });
});
