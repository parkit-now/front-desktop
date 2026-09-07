import type { LocalCashSession } from '../db/localDb';
import { formatArgentinaDateTime } from './argentina';

export function cashSessionLabel(session: LocalCashSession): string {
  const opened = formatArgentinaDateTime(session.openedAt);
  return session.closedAt
    ? `${opened} – ${formatArgentinaDateTime(session.closedAt)}`
    : `${opened} (abierta)`;
}
