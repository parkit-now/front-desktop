import { useEffect, useState, type ReactNode } from 'react';
import './stayDateCell.css';

const dateFormatter = new Intl.DateTimeFormat('es-AR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: 'America/Argentina/Buenos_Aires',
});

const timeFormatter = new Intl.DateTimeFormat('es-AR', {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZone: 'America/Argentina/Buenos_Aires',
});

export function formatTableDateTime(value: string): {
  date: string;
  time: string;
} | null {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return null;
  return {
    date: dateFormatter.format(parsed),
    time: timeFormatter.format(parsed),
  };
}

export function TableDateTimeCell({
  value,
  children,
}: {
  value: string;
  children?: ReactNode;
}) {
  const formatted = formatTableDateTime(value);
  if (!formatted) return <span className="dt-stay-cell__empty">—</span>;
  return (
    <span className="dt-stay-cell">
      <span className="dt-stay-cell__date">{formatted.date}</span>
      <span className="dt-stay-cell__time">{formatted.time}</span>
      {children}
    </span>
  );
}

export function formatStayDuration(
  enteredAt: string,
  leftAt: string | null | undefined,
  nowMs = Date.now(),
): string {
  const start = Date.parse(enteredAt);
  const end = leftAt ? Date.parse(leftAt) : nowMs;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start)
    return '—';
  const minutes = Math.floor((end - start) / 60_000);
  if (minutes === 0) return '< 1 min';
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const remainingMinutes = minutes % 60;
  return [
    days ? `${days} d` : null,
    hours ? `${hours} h` : null,
    remainingMinutes ? `${remainingMinutes} min` : null,
  ]
    .filter(Boolean)
    .join(' ');
}

export function StayDateCell({
  enteredAt,
  leftAt,
}: {
  enteredAt: string;
  leftAt?: string | null;
}) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (leftAt) return;
    const timer = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [leftAt]);

  const duration = formatStayDuration(enteredAt, leftAt, nowMs);
  return (
    <TableDateTimeCell value={enteredAt}>
      <span
        className={`dt-stay-cell__duration${leftAt ? '' : ' dt-stay-cell__duration--live'}`}
      >
        {leftAt ? duration : `En curso · ${duration}`}
      </span>
    </TableDateTimeCell>
  );
}
