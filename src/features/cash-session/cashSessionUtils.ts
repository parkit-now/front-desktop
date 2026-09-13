import type {
  LocalCashSession,
  LocalEntry,
  LocalPaymentTransaction,
} from '../../lib/db/localDb';
import { isCashMethod } from '../entries/entryUtils';

export interface PmSummary {
  pmId: string;
  pmName: string;
  total: number;
  count: number;
  isCash: boolean;
}

export interface SessionSummary {
  byPm: PmSummary[];
  grandTotal: number;
  txCount: number;
  openingCash: number;
  cashCollected: number;
  cashTotal: number;
}

export type CashHandoffStatus = 'ok' | 'over' | 'unknown';

export interface SessionStats {
  summary: SessionSummary;
  vehicleCount: number;
  vehiclesStillParked: number;
  paidEntryCount: number;
  averageTicket: number | null;
  averageStayMinutes: number | null;
  shiftDurationMinutes: number | null;
  topRate: { name: string; count: number } | null;
  withdrawnCash: number | null;
  handoffStatus: CashHandoffStatus;
}

export function computeSessionSummary(
  transactions: LocalPaymentTransaction[],
  openingCash: number,
): SessionSummary {
  const byPmMap = new Map<string, PmSummary>();
  let grandTotal = 0;

  for (const tx of transactions) {
    const key = tx.paymentMethodId ?? tx.paymentMethodName;
    const existing = byPmMap.get(key);
    if (existing) {
      existing.total += tx.amount;
      existing.count += 1;
    } else {
      byPmMap.set(key, {
        pmId: key,
        pmName: tx.paymentMethodName,
        total: tx.amount,
        count: 1,
        // Por el TIPO snapshoteado al cobrar, no por el nombre: el dueño puede
        // haber renombrado el método a "Caja" después, y esa plata entró al
        // cajón igual.
        isCash: isCashMethod(tx.paymentMethodType, tx.paymentMethodName),
      });
    }
    grandTotal += tx.amount;
  }

  const byPm = [...byPmMap.values()].sort(
    (a, b) => b.total - a.total || a.pmName.localeCompare(b.pmName, 'es'),
  );
  const cashCollected = byPm
    .filter((pm) => pm.isCash)
    .reduce((sum, pm) => sum + pm.total, 0);

  return {
    byPm,
    grandTotal,
    txCount: transactions.length,
    openingCash,
    cashCollected,
    cashTotal: openingCash + cashCollected,
  };
}

export function computeSummariesBySession(
  sessions: LocalCashSession[],
  transactions: LocalPaymentTransaction[],
): Map<string, SessionSummary> {
  const txBySession = new Map<string, LocalPaymentTransaction[]>();
  for (const tx of transactions) {
    if (!tx.cashSessionId) continue;
    const bucket = txBySession.get(tx.cashSessionId);
    if (bucket) bucket.push(tx);
    else txBySession.set(tx.cashSessionId, [tx]);
  }

  const summaries = new Map<string, SessionSummary>();
  for (const session of sessions) {
    summaries.set(
      session.id,
      computeSessionSummary(
        txBySession.get(session.id) ?? [],
        session.openingCash,
      ),
    );
  }
  return summaries;
}

export function pmShare(total: number, grandTotal: number): number {
  if (grandTotal <= 0) return 0;
  return total / grandTotal;
}

function minutesBetween(from: string, to: string): number | null {
  const fromMs = new Date(from).getTime();
  const toMs = new Date(to).getTime();
  if (Number.isNaN(fromMs) || Number.isNaN(toMs)) return null;
  const minutes = (toMs - fromMs) / 60000;
  return minutes < 0 ? null : minutes;
}

function computeTopRate(
  entries: LocalEntry[],
): { name: string; count: number } | null {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    if (!entry.rateSnapshotName) continue;
    counts.set(
      entry.rateSnapshotName,
      (counts.get(entry.rateSnapshotName) ?? 0) + 1,
    );
  }

  let top: { name: string; count: number } | null = null;
  for (const [name, count] of counts) {
    if (!top || count > top.count) top = { name, count };
  }
  return top;
}

export function computeSessionStats(
  session: LocalCashSession,
  entries: LocalEntry[],
  transactions: LocalPaymentTransaction[],
  now: number = Date.now(),
): SessionStats {
  const summary = computeSessionSummary(transactions, session.openingCash);

  const paidEntryCount = new Set(transactions.map((tx) => tx.entryId)).size;

  const stays = entries
    .map((entry) =>
      entry.leftAt ? minutesBetween(entry.enteredAt, entry.leftAt) : null,
    )
    .filter((minutes): minutes is number => minutes !== null);

  const withdrawnCash =
    session.leavingCash != null
      ? summary.cashTotal - session.leavingCash
      : null;

  return {
    summary,
    vehicleCount: entries.length,
    vehiclesStillParked: entries.filter((entry) => !entry.leftAt).length,
    paidEntryCount,
    averageTicket:
      paidEntryCount > 0 ? summary.grandTotal / paidEntryCount : null,
    averageStayMinutes:
      stays.length > 0
        ? stays.reduce((sum, minutes) => sum + minutes, 0) / stays.length
        : null,
    // An open session reports how long it has been running so far.
    shiftDurationMinutes: minutesBetween(
      session.openedAt,
      session.closedAt ?? new Date(now).toISOString(),
    ),
    topRate: computeTopRate(entries),
    withdrawnCash,
    handoffStatus:
      withdrawnCash === null
        ? 'unknown'
        : withdrawnCash < -0.01
          ? 'over'
          : 'ok',
  };
}
