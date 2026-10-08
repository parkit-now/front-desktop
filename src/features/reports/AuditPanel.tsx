import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import {
  Camera,
  RefreshCw,
  Search,
  ShieldCheck,
  X,
  ZoomIn,
  ZoomOut,
  RotateCcw,
} from 'lucide-react';
import { localDb } from '../../lib/db/localDb';
import { useNetwork } from '../../lib/network/NetworkContext';
import { translateApiError } from '../../lib/api/translate';
import {
  getLprImageUrl,
  listAudit,
  listDismissedLpr,
  REPORT_MAX_ITEMS,
  type LprEvent,
} from '../../lib/api/reports';
import { DateRangeFilter, type DateRange } from '../../lib/ui/DateRangeFilter';
import { AppSelect } from '../../lib/ui/AppSelect';
import { DataTable } from '../data-table/DataTable';
import { Pagination } from '../data-table/components/Pagination';
import { PlateCell } from '../data-table/components/PlateCell';
import { VehicleCell } from '../data-table/components/VehicleCell';
import { dateTimeSorting } from '../data-table/utils';
import { dateTime, money, arIso, arDay } from './reportUtils';
import { ReportTableLoading } from './ReportLoading';
import { AuditRiskOverview } from './AuditRiskOverview';
import {
  auditFieldLabel,
  metadataLines,
  riskTotals,
  toAuditRow,
  visibleAuditEvent,
  type AuditRow,
  stringValue,
  record,
} from './auditReportUtils';

type Props = {
  tenantId: string;
  bearer: string;
  userId: string;
  parkingName?: string | null;
};
const statusLabels = { info: 'Info', warn: 'Advertencia', crit: 'Crítico' };
const comparisonFields = [
  'plate',
  'color',
  'cochera',
  'notes',
  'enteredAt',
  'leftAt',
  'vehicleBrand',
  'vehicleModel',
  'rateSnapshotName',
  'rateSnapshotHourPriceArs',
  'rateSnapshotStayPriceArs',
  'rateSnapshotFractionPriceArs',
  'amountPaid',
  'payments',
];
const originLabels: Record<string, string> = {
  history: 'Historial',
  operational_exit: 'Panel operativo',
  desktop: 'Aplicación desktop',
  unknown: 'Sin origen',
};
const roleLabels: Record<string, string> = {
  owner: 'Dueño',
  operator: 'Operador',
  admin: 'Administrador',
};

function metadataNumber(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function signedMoney(value: number | null) {
  return value === null
    ? '—'
    : `${value > 0 ? '+' : value < 0 ? '-' : ''}${money(Math.abs(value))}`;
}

function economicMoney(economic: Record<string, unknown>, key: string) {
  const value = metadataNumber(economic, key);
  return value === null ? '—' : money(value);
}

function MoneyGrid({
  title,
  items,
}: {
  title: string;
  items: { label: string; value: string }[];
}) {
  return (
    <section className="report-detail-section">
      <h3>{title}</h3>
      <dl className="report-detail-money-grid">
        {items.map((item) => (
          <div key={item.label}>
            <dt>{item.label}</dt>
            <dd>{item.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function comparisonValue(field: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (field === 'payments' && Array.isArray(value)) {
    return (
      value
        .map((item) => {
          const payment = record(item);
          const amount =
            typeof payment.amount === 'number' ? money(payment.amount) : '—';
          return `${stringValue(payment.paymentMethodName) || 'Medio sin nombre'}: ${amount}`;
        })
        .join(' · ') || '—'
    );
  }
  if (typeof value === 'number' && /amount|price/i.test(field))
    return money(value);
  if (typeof value === 'string' && /At$/.test(field)) {
    const time = new Date(value).getTime();
    return Number.isFinite(time) ? dateTime(value) : value;
  }
  if (typeof value === 'object') return JSON.stringify(value, null, 2);
  if (typeof value === 'boolean') return value ? 'Sí' : 'No';
  return stringValue(value) || '—';
}

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function nextDay(date: Date) {
  return dateKey(
    new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1),
  );
}
function useEscape(active: boolean, close: () => void) {
  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, close]);
}

function AuditDetail({
  row,
  cashLabel,
  onClose,
}: {
  row: AuditRow;
  cashLabel: string;
  onClose: () => void;
}) {
  useEscape(true, onClose);
  const drawerRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    closeRef.current?.focus();
    return () => previous?.focus();
  }, []);
  const comparison = [
    ...new Set([...comparisonFields, ...row.changedFields]),
  ].filter(
    (field) =>
      row.changedFields.includes(field) ||
      row.before[field] !== undefined ||
      row.after[field] !== undefined,
  );
  const economic = record(row.metadata.economicImpact);
  const hasEconomic = Object.values(economic).some(
    (value) => typeof value === 'number' && Number.isFinite(value),
  );
  const changedLabels = [...new Set(row.changedFields.map(auditFieldLabel))];
  const extraMetadata = metadataLines(row);
  const suggested = metadataNumber(row.metadata, 'suggestedAmount');
  const charged = metadataNumber(row.metadata, 'chargedAmount');
  const undercharge = metadataNumber(row.metadata, 'delta');
  const chargedPct =
    suggested && charged !== null
      ? Math.round((charged / suggested) * 100)
      : null;
  return (
    <div
      className="report-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside
        ref={drawerRef}
        className="report-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Detalle de auditoría"
        onKeyDown={(event) => {
          if (event.key !== 'Tab') return;
          const focusable = Array.from(
            drawerRef.current?.querySelectorAll<HTMLElement>(
              'button, summary, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
            ) ?? [],
          ).filter((item) => !item.hasAttribute('disabled'));
          const first = focusable[0];
          const last = focusable.at(-1);
          if (!first || !last) return;
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }}
      >
        <div className="report-dialog-header">
          <div>
            <div className="report-detail-badges">
              <span className="report-badge report-badge--action">
                {row.label}
              </span>
              <span className={`report-badge report-badge--${row.severity}`}>
                {statusLabels[row.severity]}
              </span>
            </div>
            <h2>{row.summary}</h2>
          </div>
          <button
            ref={closeRef}
            className="report-icon-button"
            onClick={onClose}
            aria-label="Cerrar detalle"
          >
            <X size={19} />
          </button>
        </div>
        <h3>Contexto</h3>
        <dl className="report-detail-grid">
          <div>
            <dt>Fecha</dt>
            <dd>{dateTime(row.createdAt)}</dd>
          </div>
          <div>
            <dt>Actor</dt>
            <dd>{row.actor}</dd>
          </div>
          <div>
            <dt>Rol</dt>
            <dd>{roleLabels[row.actorRole] ?? row.actorRole}</dd>
          </div>
          <div>
            <dt>Origen</dt>
            <dd>{originLabels[row.origin] ?? row.origin}</dd>
          </div>
          <div>
            <dt>Patente</dt>
            <dd>
              <PlateCell plate={row.plate} />
            </dd>
          </div>
          <div>
            <dt>Ticket</dt>
            <dd>{row.ticket}</dd>
          </div>
          <div>
            <dt>Caja</dt>
            <dd>{cashLabel}</dd>
          </div>
          {row.reason !== '-' && (
            <div>
              <dt>Razón</dt>
              <dd>{row.reason}</dd>
            </div>
          )}
        </dl>
        {row.kind === 'entry.corrected' && (
          <>
            {hasEconomic && (
              <MoneyGrid
                title="Impacto estimado"
                items={[
                  {
                    label: 'Sugerido antes',
                    value: economicMoney(economic, 'suggestedBefore'),
                  },
                  {
                    label: 'Sugerido después',
                    value: economicMoney(economic, 'suggestedAfter'),
                  },
                  {
                    label: 'Impacto horario/tarifa',
                    value: signedMoney(
                      metadataNumber(economic, 'suggestedDelta'),
                    ),
                  },
                  {
                    label: 'Cobrado antes',
                    value: economicMoney(economic, 'chargedBefore'),
                  },
                  {
                    label: 'Cobrado después',
                    value: economicMoney(economic, 'chargedAfter'),
                  },
                  {
                    label: 'Cambio cobrado',
                    value: signedMoney(
                      metadataNumber(economic, 'chargedDelta'),
                    ),
                  },
                  {
                    label: 'Diferencia vs sugerido',
                    value: signedMoney(
                      metadataNumber(economic, 'deltaVsSuggestedAfter'),
                    ),
                  },
                ]}
              />
            )}
            {!hasEconomic && row.impact !== null && (
              <section className="report-detail-impact">
                <strong>Cambio cobrado</strong>
                <span>{signedMoney(row.impact)}</span>
              </section>
            )}
            <section className="report-detail-section">
              <h3>Campos modificados</h3>
              <div className="report-detail-chip-list">
                {changedLabels.length ? (
                  changedLabels.map((field) => (
                    <span
                      className="report-badge report-badge--action"
                      key={field}
                    >
                      {field}
                    </span>
                  ))
                ) : (
                  <span className="muted">Sin campos detectados</span>
                )}
              </div>
            </section>
            <section className="report-detail-section">
              <h3>Antes y después</h3>
              {comparison.length ? (
                <div className="report-table-scroll dt-scroll-shell">
                  <table className="report-table dt-table">
                    <thead>
                      <tr>
                        <th>Campo</th>
                        <th>Antes</th>
                        <th>Después</th>
                      </tr>
                    </thead>
                    <tbody>
                      {comparison.map((field) => (
                        <tr key={field}>
                          <td>
                            {auditFieldLabel(field)}
                            {(row.changedFields.includes(field) ||
                              (field === 'payments' &&
                                row.changedFields.includes('amountPaid'))) && (
                              <small className="report-change-badge">
                                Modificado
                              </small>
                            )}
                          </td>
                          <td className="report-metadata-value">
                            {comparisonValue(field, row.before[field])}
                          </td>
                          <td className="report-metadata-value">
                            {comparisonValue(field, row.after[field])}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="muted">
                  No hay valores anteriores o posteriores para comparar.
                </p>
              )}
            </section>
          </>
        )}
        {row.kind === 'entry.undercharged' && (
          <MoneyGrid
            title="Impacto monetario"
            items={[
              {
                label: 'Sugerido',
                value: suggested === null ? '—' : money(suggested),
              },
              {
                label: 'Cobrado',
                value: charged === null ? '—' : money(charged),
              },
              {
                label: 'Diferencia',
                value: undercharge === null ? '—' : money(undercharge),
              },
              {
                label: 'Porcentaje',
                value: chargedPct === null ? '—' : `${chargedPct}%`,
              },
            ]}
          />
        )}
        {row.kind === 'entry.deleted' && (
          <section className="report-detail-section">
            <h3>Cobro retirado</h3>
            <p className="report-detail-copy">
              {metadataNumber(row.metadata, 'amountPaid')
                ? `Se retiraron ${money(metadataNumber(row.metadata, 'amountPaid')!)} de la caja. La baja no devuelve dinero al cliente.`
                : 'Este ingreso no tenía un cobro asociado.'}
            </p>
          </section>
        )}
        {row.kind === 'invoice.cert_expired' && (
          <section className="report-detail-section">
            <h3>Factura pendiente</h3>
            <p className="report-detail-copy">
              Se cobraron {charged === null ? 'el monto' : money(charged)} con
              un medio que factura, pero el certificado de ARCA estaba vencido y
              la factura quedó pendiente. Renová el certificado desde
              Integraciones en la web.
            </p>
          </section>
        )}
        {row.kind === 'other' && row.impact !== null && (
          <section className="report-detail-impact">
            <strong>Impacto</strong>
            <span>{signedMoney(row.impact)}</span>
          </section>
        )}
        {row.kind === 'other' && (
          <section className="report-detail-section">
            <h3>Metadatos</h3>
            {extraMetadata.length ? (
              <dl className="report-detail-grid">
                {extraMetadata.map((item) => (
                  <div key={item.label}>
                    <dt>{item.label}</dt>
                    <dd className="report-metadata-value">{item.value}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="report-detail-copy">
                Este evento no trae metadatos adicionales.
              </p>
            )}
          </section>
        )}
      </aside>
    </div>
  );
}

export function LprPhoto({
  tenantId,
  bearer,
  event,
}: {
  tenantId: string;
  bearer: string;
  event: LprEvent;
}) {
  const [expanded, setExpanded] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const frameRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    panX: number;
    panY: number;
  } | null>(null);
  const image = useQuery({
    queryKey: [
      'reports',
      tenantId,
      'lpr-image',
      event.id,
      event.imageStoragePath,
    ],
    queryFn: ({ signal }) =>
      getLprImageUrl({ tenantId, bearer, eventId: event.id, signal }),
    enabled: Boolean(event.imageStoragePath),
    staleTime: 4 * 60_000,
    retry: 1,
  });
  const close = () => {
    setExpanded(false);
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setDragging(false);
    dragRef.current = null;
  };
  useEscape(expanded, close);
  useEffect(() => {
    const frame = frameRef.current;
    if (!expanded || !frame) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      setZoom((current) => {
        const next = Math.max(
          1,
          Math.min(4, current + (event.deltaY < 0 ? 0.25 : -0.25)),
        );
        if (next === 1) setPan({ x: 0, y: 0 });
        return next;
      });
    };
    frame.addEventListener('wheel', onWheel, { passive: false });
    return () => frame.removeEventListener('wheel', onWheel);
  }, [expanded]);
  if (!event.imageStoragePath)
    return (
      <div className="report-lpr-image report-lpr-image--empty">Sin imagen</div>
    );
  if (image.isLoading)
    return (
      <div
        className="report-lpr-image report-lpr-image--empty"
        role="status"
        aria-label="Cargando imagen"
      >
        <span
          className="report-skeleton report-skeleton--image"
          aria-hidden="true"
        />
        <span className="sr-only">Cargando imagen</span>
      </div>
    );
  if (!image.data?.url)
    return (
      <div className="report-lpr-image report-lpr-image--empty">
        No se pudo cargar la imagen
      </div>
    );
  const overlay = event.plateBbox;
  const picture = (large: boolean) => (
    <div
      className="report-lpr-photo-stage"
      style={
        large
          ? { transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }
          : undefined
      }
    >
      <img
        src={image.data.url}
        alt={`Detección ${event.displayPlate ?? event.normalizedText ?? event.rawText ?? ''}`}
        draggable={false}
        onDragStart={(event) => event.preventDefault()}
      />
      {overlay && (
        <span
          className="report-lpr-box"
          style={{
            left: `${overlay.x * 100}%`,
            top: `${overlay.y * 100}%`,
            width: `${overlay.w * 100}%`,
            height: `${overlay.h * 100}%`,
          }}
        />
      )}
    </div>
  );
  return (
    <>
      <button
        className="report-lpr-image"
        onClick={() => setExpanded(true)}
        aria-label="Ampliar imagen de detección"
      >
        {picture(false)}
      </button>
      {expanded && (
        <div
          className="report-overlay"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) close();
          }}
        >
          <div
            className="report-photo-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Imagen de detección LPR"
          >
            <div className="report-dialog-header">
              <h2>
                {event.displayPlate ?? event.normalizedText ?? 'Detección LPR'}
              </h2>
              <button
                className="report-icon-button"
                onClick={close}
                aria-label="Cerrar imagen"
              >
                <X size={19} />
              </button>
            </div>
            <div className="report-photo-tools" aria-label="Zoom de imagen">
              <button
                onClick={() => setZoom((value) => Math.min(4, value + 0.25))}
                disabled={zoom >= 4}
                title="Acercar"
              >
                <ZoomIn size={18} />
              </button>
              <strong>{Math.round(zoom * 100)}%</strong>
              <button
                onClick={() => {
                  setZoom((value) => Math.max(1, value - 0.25));
                  if (zoom <= 1.25) setPan({ x: 0, y: 0 });
                }}
                disabled={zoom <= 1}
                title="Alejar"
              >
                <ZoomOut size={18} />
              </button>
              <button
                onClick={() => {
                  setZoom(1);
                  setPan({ x: 0, y: 0 });
                }}
                title="Restablecer zoom"
              >
                <RotateCcw size={18} />
              </button>
            </div>
            <div
              ref={frameRef}
              className={`report-photo-viewport${zoom > 1 ? ' is-pannable' : ''}${dragging ? ' is-dragging' : ''}`}
              onPointerDown={(event) => {
                if (zoom <= 1 || event.button !== 0) return;
                event.preventDefault();
                event.currentTarget.setPointerCapture(event.pointerId);
                dragRef.current = {
                  pointerId: event.pointerId,
                  startX: event.clientX,
                  startY: event.clientY,
                  panX: pan.x,
                  panY: pan.y,
                };
                setDragging(true);
              }}
              onPointerMove={(event) => {
                const drag = dragRef.current;
                if (drag && drag.pointerId === event.pointerId)
                  setPan({
                    x: drag.panX + event.clientX - drag.startX,
                    y: drag.panY + event.clientY - drag.startY,
                  });
              }}
              onPointerUp={(event) => {
                if (dragRef.current?.pointerId !== event.pointerId) return;
                dragRef.current = null;
                setDragging(false);
                event.currentTarget.releasePointerCapture(event.pointerId);
              }}
              onPointerCancel={() => {
                dragRef.current = null;
                setDragging(false);
              }}
            >
              {picture(true)}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function LprCard({
  tenantId,
  bearer,
  event,
}: {
  tenantId: string;
  bearer: string;
  event: LprEvent;
}) {
  const plate =
    event.displayPlate ?? event.normalizedText ?? event.rawText ?? '-';
  return (
    <article className="report-lpr-card">
      <LprPhoto tenantId={tenantId} bearer={bearer} event={event} />
      <div className="report-lpr-card-body">
        <div className="report-lpr-card-head">
          <PlateCell plate={plate} />
          <span
            className={`report-badge report-badge--${event.confidence >= 0.85 ? 'warn' : 'info'}`}
          >
            {Math.round(event.confidence * 100)}%
          </span>
        </div>
        <dl>
          <div>
            <dt>Detectada</dt>
            <dd>{dateTime(event.firstSeenAt)}</dd>
          </div>
          <div>
            <dt>Ubicación</dt>
            <dd>{event.location}</dd>
          </div>
          <div>
            <dt>Revisó</dt>
            <dd>{event.reviewedByName ?? 'Sin nombre'}</dd>
          </div>
          <div>
            <dt>Calidad</dt>
            <dd>{event.qualityStatus.replaceAll('_', ' ')}</dd>
          </div>
        </dl>
      </div>
    </article>
  );
}

export function AuditPanel({ tenantId, bearer, userId, parkingName }: Props) {
  const { isOnline } = useNetwork();
  const queryClient = useQueryClient();
  const [range, setRange] = useState<DateRange>();
  const [tab, setTab] = useState<'events' | 'lpr'>('events');
  const [selected, setSelected] = useState<AuditRow | null>(null);
  const [currentCashOnly, setCurrentCashOnly] = useState(false);
  const [lprSearch, setLprSearch] = useState('');
  const [lprSeverity, setLprSeverity] = useState('');
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(24);
  const cashSessions = useLiveQuery(
    () => localDb.cashSessions.where('tenantId').equals(tenantId).toArray(),
    [tenantId],
  );
  const activeCash = cashSessions?.find((item) => !item.closedAt);
  const from = range?.from ? arIso(dateKey(range.from)) : undefined;
  const to = range?.from ? arIso(nextDay(range.to ?? range.from)) : undefined;
  const audit = useQuery({
    queryKey: ['reports', tenantId, 'audit', from, to],
    queryFn: ({ signal }) => listAudit({ tenantId, bearer, from, to, signal }),
    enabled: isOnline,
    staleTime: 0,
    refetchOnMount: 'always',
  });
  const lpr = useQuery({
    queryKey: ['reports', tenantId, 'dismissed-lpr', from, to],
    queryFn: ({ signal }) =>
      listDismissedLpr({
        tenantId,
        bearer,
        firstSeenFrom: from,
        firstSeenTo: to,
        signal,
      }),
    enabled: isOnline,
    staleTime: 0,
    refetchOnMount: 'always',
  });
  const allRows = useMemo(
    () => (audit.data?.items ?? []).filter(visibleAuditEvent).map(toAuditRow),
    [audit.data],
  );
  const rows = currentCashOnly
    ? allRows.filter((item) => item.cashSessionId === activeCash?.id)
    : allRows;
  const lprItems = (lpr.data?.items ?? []).filter((item) => {
    const text = [item.displayPlate, item.rawText, item.normalizedText]
      .join(' ')
      .toLowerCase();
    return (
      text.includes(lprSearch.toLowerCase()) &&
      (!lprSeverity ||
        (item.confidence >= 0.85 ? 'warn' : 'info') === lprSeverity)
    );
  });
  const pageCount = Math.max(1, Math.ceil(lprItems.length / pageSize));
  const safePage = Math.min(pageIndex, pageCount - 1);
  const risk = riskTotals(
    allRows,
    (lpr.data?.items ?? []).filter((item) => item.confidence >= 0.85).length,
  );
  const cashOptions = (cashSessions ?? []).map((item) => ({
    value: item.id,
    label: `${dateTime(item.openedAt)}${item.closedAt ? '' : ' · abierta'}`,
  }));
  const columns = useMemo<ColumnDef<AuditRow, unknown>[]>(
    () => [
      {
        id: 'date',
        header: 'Fecha',
        accessorKey: 'date',
        sortingFn: dateTimeSorting((row) => row.createdAt),
        cell: ({ row }) => dateTime(row.original.createdAt),
      },
      {
        id: 'severity',
        header: 'Severidad',
        accessorKey: 'severity',
        cell: ({ row }) => (
          <span
            className={`report-badge report-badge--${row.original.severity}`}
          >
            {statusLabels[row.original.severity]}
          </span>
        ),
      },
      {
        id: 'action',
        header: 'Acción',
        accessorKey: 'action',
        cell: ({ row }) => (
          <span className="report-badge report-badge--action">
            {row.original.label}
          </span>
        ),
      },
      { id: 'actor', header: 'Actor', accessorKey: 'actor' },
      { id: 'actorRole', header: 'Rol', accessorKey: 'actorRole' },
      { id: 'origin', header: 'Origen', accessorKey: 'origin' },
      {
        id: 'plate',
        header: 'Patente / ticket',
        accessorKey: 'plate',
        cell: ({ row }) => (
          <div className="report-stack">
            <PlateCell plate={row.original.plate} />
            <small>Ticket {row.original.ticket}</small>
          </div>
        ),
      },
      {
        id: 'vehicle',
        header: 'Vehículo',
        accessorFn: (row) =>
          `${row.vehicleBrand} ${row.vehicleModel} ${row.color}`,
        cell: ({ row }) => (
          <VehicleCell
            brand={row.original.vehicleBrand}
            model={row.original.vehicleModel}
            colors={row.original.color ? [row.original.color] : []}
          />
        ),
      },
      {
        id: 'vehicleBrand',
        header: 'Marca',
        accessorKey: 'vehicleBrand',
        filterFn: 'includesSome',
      },
      {
        id: 'vehicleModel',
        header: 'Modelo',
        accessorKey: 'vehicleModel',
        filterFn: 'includesSome',
      },
      {
        id: 'color',
        header: 'Color',
        accessorKey: 'color',
        filterFn: 'includesSome',
      },
      {
        id: 'enteredAt',
        header: 'Ingreso',
        accessorFn: (row) =>
          row.enteredAt ? arDay(new Date(row.enteredAt)) : '',
        sortingFn: dateTimeSorting((row) => row.enteredAt),
        filterFn: 'dateRange',
        cell: ({ row }) =>
          row.original.enteredAt ? dateTime(row.original.enteredAt) : '—',
      },
      {
        id: 'leftAt',
        header: 'Egreso',
        accessorFn: (row) => (row.leftAt ? arDay(new Date(row.leftAt)) : ''),
        sortingFn: dateTimeSorting((row) => row.leftAt),
        filterFn: 'dateRange',
        cell: ({ row }) =>
          row.original.leftAt ? dateTime(row.original.leftAt) : '—',
      },
      { id: 'cashSessionId', header: 'Caja', accessorKey: 'cashSessionId' },
      {
        id: 'paymentMethod',
        header: 'Medio de pago',
        accessorKey: 'paymentMethod',
      },
      { id: 'rate', header: 'Tarifa', accessorKey: 'rate' },
      { id: 'summary', header: 'Resumen', accessorKey: 'summary' },
      {
        id: 'impact',
        header: 'Impacto',
        accessorKey: 'impact',
        cell: ({ row }) =>
          row.original.impact === null ? '—' : money(row.original.impact),
      },
    ],
    [],
  );
  const refresh = () =>
    void queryClient.invalidateQueries({ queryKey: ['reports', tenantId] });
  if (!isOnline)
    return (
      <div className="report-empty">
        <ShieldCheck size={25} />
        <strong>Auditoría disponible con conexión</strong>
        <span>
          Los eventos se consultan en el servidor. No se muestran datos
          desactualizados.
        </span>
      </div>
    );
  return (
    <div className="report-page">
      <div className="report-heading">
        <div>
          <h2>Auditoría</h2>
          <p>
            {parkingName ? `${parkingName} · ` : ''}
            {audit.isLoading
              ? 'Cargando eventos'
              : audit.isError
                ? 'No se pudieron cargar los eventos'
                : `${risk.alerts.toLocaleString('es-AR')} eventos críticos o advertencias`}
          </p>
        </div>
        <div className="report-heading-actions">
          <DateRangeFilter
            value={range}
            onChange={(next) => {
              setRange(next);
              setPageIndex(0);
            }}
            placeholder="Período auditado"
          />
          <button
            className="report-audit-refresh"
            type="button"
            onClick={refresh}
          >
            <RefreshCw
              size={17}
              className={
                audit.isFetching || lpr.isFetching ? 'is-spinning' : undefined
              }
            />
            Actualizar
          </button>
        </div>
      </div>
      <AuditRiskOverview
        risk={risk}
        eventsLoading={audit.isLoading}
        eventsError={audit.isError}
        lprLoading={lpr.isLoading}
        lprError={lpr.isError}
      />
      {((audit.data && audit.data.total > audit.data.items.length) ||
        (lpr.data && lpr.data.total > lpr.data.items.length)) && (
        <p className="report-limit">
          El resumen se calcula sobre los resultados cargados, hasta{' '}
          {REPORT_MAX_ITEMS.toLocaleString('es-AR')} por listado. Acotá el
          período para analizar otros eventos.
        </p>
      )}
      <div className="report-tabs" role="tablist" aria-label="Auditoría">
        <button
          role="tab"
          aria-selected={tab === 'events'}
          className={tab === 'events' ? 'active' : ''}
          onClick={() => setTab('events')}
        >
          Eventos
        </button>
        <button
          role="tab"
          aria-selected={tab === 'lpr'}
          className={tab === 'lpr' ? 'active' : ''}
          onClick={() => setTab('lpr')}
        >
          Patentes descartadas
        </button>
      </div>
      {tab === 'events' ? (
        audit.isError ? (
          <p className="report-error" role="alert">
            {translateApiError(audit.error)}{' '}
            <button onClick={() => void audit.refetch()}>Reintentar</button>
          </p>
        ) : (
          <>
            {audit.isLoading ? (
              <ReportTableLoading
                columns={[
                  'Fecha',
                  'Severidad',
                  'Acción',
                  'Actor',
                  'Rol',
                  'Origen',
                  'Patente / ticket',
                  'Resumen',
                  'Impacto',
                ]}
                rows={7}
              />
            ) : (
              <DataTable<AuditRow>
                data={rows}
                columns={columns}
                isLoading={audit.isLoading}
                emptyMessage="No hay eventos de auditoría para mostrar."
                searchPlaceholder="Buscar por patente, actor, ticket, razón o campo"
                searchableKeys={['searchText']}
                filterableColumns={[
                  'severity',
                  'action',
                  'origin',
                  'cashSessionId',
                  'paymentMethod',
                  'rate',
                  'vehicle',
                  'vehicleBrand',
                  'vehicleModel',
                  'color',
                  'enteredAt',
                  'leftAt',
                ]}
                filterOptionsByColumn={{
                  severity: [
                    { value: 'info', label: 'Info' },
                    { value: 'warn', label: 'Advertencia' },
                    { value: 'crit', label: 'Crítico' },
                  ],
                  cashSessionId: cashOptions,
                  action: [
                    {
                      value: 'entry.corrected',
                      label: 'Corrección de estadía',
                    },
                    { value: 'entry.deleted', label: 'Ingreso eliminado' },
                    {
                      value: 'entry.undercharged',
                      label: 'Cobro menor al sugerido',
                    },
                    {
                      value: 'invoice.cert_expired',
                      label: 'Cobro sin factura',
                    },
                  ],
                }}
                initialColumnFilters={[
                  { id: 'severity', value: ['warn', 'crit'] },
                ]}
                initialColumnVisibility={{
                  enteredAt: false,
                  leftAt: false,
                  cashSessionId: false,
                  paymentMethod: false,
                  rate: false,
                  vehicle: false,
                  vehicleBrand: false,
                  vehicleModel: false,
                  color: false,
                }}
                getRowId={(row) => row.id}
                initialPageSize={10}
                initialSorting={[{ id: 'date', desc: true }]}
                onRowClick={setSelected}
                filterSwitches={[
                  {
                    id: 'current-cash',
                    label: 'Solo caja actual',
                    checked: currentCashOnly,
                    disabled: !activeCash,
                    onChange: setCurrentCashOnly,
                  },
                ]}
                templateScope={{
                  userId,
                  tenantId,
                  tableKey: 'owner-audit-desktop',
                }}
                onRefresh={() => void audit.refetch()}
                refreshDisabled={audit.isFetching}
              />
            )}
            {audit.data && audit.data.total > audit.data.items.length && (
              <p className="report-limit">
                Mostrando los {audit.data.items.length} eventos más recientes de{' '}
                {audit.data.total} para este período. Acotá las fechas para ver
                otros.
              </p>
            )}
          </>
        )
      ) : (
        <>
          {lpr.isError ? (
            <p className="report-error" role="alert">
              {translateApiError(lpr.error)}{' '}
              <button onClick={() => void lpr.refetch()}>Reintentar</button>
            </p>
          ) : (
            <>
              <div className="report-lpr-toolbar">
                <label className="report-search">
                  <Search size={16} />
                  <input
                    value={lprSearch}
                    onChange={(event) => {
                      setLprSearch(event.target.value);
                      setPageIndex(0);
                    }}
                    placeholder="Buscar patente"
                  />
                </label>
                <label>
                  Severidad{' '}
                  <AppSelect
                    value={lprSeverity}
                    onChange={(value) => {
                      setLprSeverity(value);
                      setPageIndex(0);
                    }}
                    options={[
                      { value: '', label: 'Todas' },
                      { value: 'warn', label: 'Advertencia' },
                      { value: 'info', label: 'Info' },
                    ]}
                  />
                </label>
                <button
                  className="report-icon-button"
                  onClick={() => void lpr.refetch()}
                  title="Actualizar descartes"
                  aria-label="Actualizar descartes"
                >
                  <RefreshCw
                    size={17}
                    className={lpr.isFetching ? 'is-spinning' : undefined}
                  />
                </button>
              </div>
              {lpr.isLoading ? (
                <div
                  className="report-lpr-grid"
                  role="status"
                  aria-label="Cargando patentes descartadas"
                >
                  <span className="sr-only">Cargando patentes descartadas</span>
                  {Array.from({ length: 6 }, (_, index) => (
                    <div
                      className="report-lpr-card report-lpr-card--loading"
                      key={index}
                      aria-hidden="true"
                    >
                      <span className="report-skeleton report-skeleton--image" />
                      <span className="report-lpr-card-body">
                        <span className="report-skeleton report-skeleton--cell" />
                        <span className="report-skeleton report-skeleton--short" />
                      </span>
                    </div>
                  ))}
                </div>
              ) : lprItems.length === 0 ? (
                <div className="report-empty">
                  <Camera size={25} />
                  Sin patentes descartadas para estos filtros.
                </div>
              ) : (
                <>
                  <div className="report-lpr-grid">
                    {lprItems
                      .slice(safePage * pageSize, (safePage + 1) * pageSize)
                      .map((item) => (
                        <LprCard
                          key={item.id}
                          tenantId={tenantId}
                          bearer={bearer}
                          event={item}
                        />
                      ))}
                  </div>
                  <Pagination
                    pageIndex={safePage}
                    pageSize={pageSize}
                    pageCount={pageCount}
                    totalRows={lprItems.length}
                    pageSizeOptions={[12, 24, 48]}
                    canPreviousPage={safePage > 0}
                    canNextPage={safePage < pageCount - 1}
                    onPageIndexChange={setPageIndex}
                    onPageSizeChange={(value) => {
                      setPageSize(value);
                      setPageIndex(0);
                    }}
                  />
                </>
              )}
              {lpr.data && lpr.data.total > lpr.data.items.length && (
                <p className="report-limit">
                  Mostrando los {lpr.data.items.length} descartes más recientes
                  de {lpr.data.total}. Acotá el período para ver otros.
                </p>
              )}
            </>
          )}
        </>
      )}
      {selected && (
        <AuditDetail
          row={selected}
          cashLabel={
            cashSessions?.find((item) => item.id === selected.cashSessionId)
              ? dateTime(
                  cashSessions.find(
                    (item) => item.id === selected.cashSessionId,
                  )!.openedAt,
                )
              : selected.cashSessionId === '-'
                ? 'Sin caja'
                : `Caja ${selected.cashSessionId.slice(0, 8)}`
          }
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
