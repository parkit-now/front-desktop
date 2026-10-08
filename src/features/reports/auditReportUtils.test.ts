import { describe, expect, it } from 'vitest';
import type { AuditEvent } from '../../lib/api/reports';
import { money } from './reportUtils';
import {
  auditFieldLabel,
  metadataLines,
  riskTotals,
  toAuditRow,
  visibleAuditEvent,
} from './auditReportUtils';

function event(
  action: string,
  metadata: unknown,
  severity: AuditEvent['severity'] = 'warn',
): AuditEvent {
  return {
    id: action,
    action,
    actorName: 'Dueño',
    entityType: 'entry',
    entityId: 'ingreso-1',
    severity,
    metadata,
    createdAt: '2026-10-08T15:00:00.000Z',
  };
}

describe('auditoría de dueño', () => {
  it('oculta eventos operativos triviales y conserva eventos desconocidos', () => {
    expect(visibleAuditEvent(event('lpr_event.dismissed', {}))).toBe(false);
    expect(visibleAuditEvent(event('rate.prices_propagated', {}))).toBe(false);
    expect(
      visibleAuditEvent(event('entry.corrected', { changedFields: ['notes'] })),
    ).toBe(false);
    expect(
      visibleAuditEvent(
        event('entry.corrected', { changedFields: ['amountPaid'] }),
      ),
    ).toBe(true);
    expect(visibleAuditEvent(event('custom.new_action', {}))).toBe(true);
  });

  it('muestra la pérdida y las reducciones con centavos sin mezclar importes', () => {
    const undercharge = toAuditRow(
      event('entry.undercharged', {
        plate: 'AB123CD',
        delta: 46.46,
      }),
    );
    const correction = toAuditRow(
      event('entry.corrected', {
        before: { amountPaid: 100 },
        after: { amountPaid: 10 },
        changedFields: ['amountPaid'],
      }),
    );
    const deletion = toAuditRow(
      event(
        'entry.deleted',
        {
          plate: 'AB123CD',
          amountPaid: 500,
        },
        'crit',
      ),
    );
    expect(undercharge.plate).toBe('AB123CD');
    expect(riskTotals([undercharge, correction, deletion], 2)).toEqual({
      alerts: 3,
      possibleLoss: 136.46,
      undercharged: 46.46,
      reductions: 90,
      suggestedReductionRisk: 0,
      suspiciousDismissals: 2,
    });
    expect(deletion.impact).toBe(500);
  });

  it('separa el riesgo de tarifa sugerida de la pérdida posible', () => {
    const correction = toAuditRow(
      event('entry.corrected', {
        changedFields: ['amountPaid'],
        economicImpact: { chargedDelta: -90, suggestedDelta: -40.5 },
      }),
    );
    expect(riskTotals([correction], 0)).toMatchObject({
      possibleLoss: 90,
      reductions: 90,
      suggestedReductionRisk: 40.5,
    });
  });

  it('muestra campos corregidos con nombres legibles y deja sus datos disponibles para comparar', () => {
    const row = toAuditRow(
      event('entry.corrected', {
        plate: 'AH167DP',
        changedFields: ['payments', 'amountPaid'],
        before: { amountPaid: 4800 },
        after: { amountPaid: 4000 },
        economicImpact: { chargedDelta: -800 },
      }),
    );

    expect(row.summary).toBe('Se corrigió AH167DP: Pagos, Total cobrado');
    expect(auditFieldLabel('payments')).toBe('Pagos');
    expect(row.before.amountPaid).toBe(4800);
    expect(row.after.amountPaid).toBe(4000);
    expect(metadataLines(row)).toEqual([]);
  });

  it('formatea los metadatos de eventos genéricos sin repetir el contexto', () => {
    const row = toAuditRow(
      event('payment_intent.refunded', {
        plate: 'AB123CD',
        origin: 'desktop',
        refundArs: 123.45,
        status: 'refund_confirmed',
      }),
    );

    expect(metadataLines(row)).toEqual([
      { label: 'Reembolso', value: money(123.45) },
      { label: 'Estado', value: 'refund confirmed' },
    ]);
  });
});
