import type { LocalPaymentTransaction } from '../../lib/db/localDb';

export interface PmSummary {
  pmName: string;
  total: number;
}

export interface SessionSummary {
  byPm: PmSummary[];
  openingCash: number;
  cashCollected: number;
  cashTotal: number;
}

export function computeSessionSummary(
  transactions: LocalPaymentTransaction[],
  openingCash: number,
): SessionSummary {
  const byPmMap = new Map<string, PmSummary>();

  for (const tx of transactions) {
    const key = tx.paymentMethodId ?? tx.paymentMethodName;
    const existing = byPmMap.get(key);
    if (existing) {
      existing.total += tx.amount;
    } else {
      byPmMap.set(key, { pmName: tx.paymentMethodName, total: tx.amount });
    }
  }

  const byPm = [...byPmMap.values()];
  const efectivo = byPm.find((pm) =>
    pm.pmName.toLowerCase().includes('efectivo'),
  );
  const cashCollected = efectivo?.total ?? 0;

  return {
    byPm,
    openingCash,
    cashCollected,
    cashTotal: openingCash + cashCollected,
  };
}
