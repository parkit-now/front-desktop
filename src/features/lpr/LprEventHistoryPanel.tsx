import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  ChevronLeft,
  ChevronRight,
  Eye,
  ScanLine,
  Search,
  X,
} from 'lucide-react';
import { localDb, type LocalLprDetectionEvent } from '../../lib/db/localDb';
import { formatArgentinaDateTime } from '../../lib/format/argentina';
import { getLprDetectionEventImageSignedUrl } from '../../lib/api/lpr-events';

interface Props {
  tenantId: string;
  accessToken: string;
}

type Direction = 'ingreso' | 'egreso';
type DirectionFilter = 'todos' | Direction;

const PAGE_SIZE = 24;

/** A `location` naming an exit lane maps the event to an `egreso`. */
function directionOf(event: LocalLprDetectionEvent): Direction {
  return /salid/i.test(event.location) ? 'egreso' : 'ingreso';
}

/** True when the event still has evidence: a stored path not yet purged. */
function hasEvidence(event: LocalLprDetectionEvent): boolean {
  return Boolean(event.imageStoragePath) && !event.imageDeletedAt;
}

function plateOf(event: LocalLprDetectionEvent): string {
  return event.displayPlate ?? event.normalizedText ?? event.rawText ?? '—';
}

function normalizePlateQuery(value: string): string {
  return value.replace(/[\s_-]/g, '').toUpperCase();
}

function confidencePct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function shortId(value: string | undefined): string {
  return value ? value.slice(0, 8) : '—';
}

const DIRECTION_LABEL: Record<Direction, string> = {
  ingreso: 'Ingreso',
  egreso: 'Egreso',
};

const QUALITY_LABEL: Record<LocalLprDetectionEvent['qualityStatus'], string> = {
  valid_high: 'Confianza alta',
  valid_low: 'Confianza media',
  invalid_format: 'Formato inválido',
  low_confidence: 'Confianza baja',
};

const STATUS_LABEL: Record<LocalLprDetectionEvent['status'], string> = {
  pending: 'Pendiente',
  registered: 'Registrado',
  dismissed: 'Descartado',
  suppressed_active_entry: 'Suprimido (ya adentro)',
  suppressed_pending_event: 'Suprimido (evento duplicado)',
  suppressed_recent_exit: 'Suprimido (egreso reciente)',
};

/** Signed URLs live ~5 min; keep them across pagination and detail toggles. */
const signedUrlCache = new Map<string, string>();

type EvidenceState = 'idle' | 'loading' | 'error' | 'ready';

function Evidence({
  tenantId,
  accessToken,
  eventId,
  storagePath,
  available,
  plate,
  size,
}: {
  tenantId: string;
  accessToken: string;
  eventId: string;
  storagePath: string | undefined;
  available: boolean;
  plate: string;
  size: 'thumb' | 'full';
}) {
  const cacheKey = `${eventId}:${storagePath ?? ''}`;
  const [url, setUrl] = useState<string | null>(
    () => signedUrlCache.get(cacheKey) ?? null,
  );
  const [state, setState] = useState<EvidenceState>(() =>
    signedUrlCache.has(cacheKey) ? 'ready' : available ? 'loading' : 'idle',
  );

  useEffect(() => {
    if (!available) {
      setState('idle');
      return;
    }
    const cached = signedUrlCache.get(cacheKey);
    if (cached) {
      setUrl(cached);
      setState('ready');
      return;
    }
    let cancelled = false;
    setState('loading');
    getLprDetectionEventImageSignedUrl({
      tenantId,
      bearer: accessToken,
      eventId,
    })
      .then((res) => {
        if (cancelled) return;
        signedUrlCache.set(cacheKey, res.url);
        setUrl(res.url);
        setState('ready');
      })
      .catch(() => {
        if (!cancelled) setState('error');
      });
    return () => {
      cancelled = true;
    };
  }, [available, cacheKey, tenantId, accessToken, eventId]);

  const box =
    size === 'thumb' ? 'lpr-history-media' : 'lpr-history-media--full';
  const iconSize = size === 'thumb' ? 22 : 32;

  if (!available) {
    return (
      <div className={box}>
        <ScanLine size={iconSize} aria-hidden="true" />
        <span>Sin imagen</span>
      </div>
    );
  }
  if (state === 'loading') {
    return (
      <div className={box}>
        <span>Cargando imagen…</span>
      </div>
    );
  }
  if (state === 'error' || !url) {
    return (
      <div className={box}>
        <ScanLine size={iconSize} aria-hidden="true" />
        <span>Imagen no disponible</span>
      </div>
    );
  }
  return (
    <img
      className={size === 'thumb' ? 'lpr-history-img' : 'lpr-history-img--full'}
      src={url}
      alt={`Patente detectada ${plate}`}
    />
  );
}

function EventCard({
  tenantId,
  accessToken,
  event,
  onOpen,
}: {
  tenantId: string;
  accessToken: string;
  event: LocalLprDetectionEvent;
  onOpen: (id: string) => void;
}) {
  const direction = directionOf(event);
  return (
    <article className="lpr-history-card">
      <div className="lpr-history-card__head">
        <Evidence
          tenantId={tenantId}
          accessToken={accessToken}
          eventId={event.id}
          storagePath={event.imageStoragePath}
          available={hasEvidence(event)}
          plate={plateOf(event)}
          size="thumb"
        />
        <span
          className={`lpr-history-badge${direction === 'egreso' ? ' lpr-history-badge--egreso' : ''}`}
        >
          {DIRECTION_LABEL[direction]}
        </span>
        <span className="lpr-history-badge lpr-history-badge--conf">
          {confidencePct(event.confidence)}
        </span>
      </div>

      <div className="lpr-history-card__body">
        <h3 className="lpr-history-card__plate">{plateOf(event)}</h3>
        <dl className="lpr-history-meta">
          <div>
            <dt>Fecha y hora</dt>
            <dd>{formatArgentinaDateTime(event.lastSeenAt)}</dd>
          </div>
          <div>
            <dt>Confianza OCR</dt>
            <dd>{QUALITY_LABEL[event.qualityStatus]}</dd>
          </div>
          <div>
            <dt>Cámara</dt>
            <dd>{event.cameraId}</dd>
          </div>
          <div>
            <dt>Estado</dt>
            <dd>{STATUS_LABEL[event.status]}</dd>
          </div>
        </dl>
        <button
          type="button"
          className="ghost-button lpr-history-detail-btn"
          onClick={() => onOpen(event.id)}
        >
          <Eye size={15} aria-hidden="true" />
          Ver detalle
        </button>
      </div>
    </article>
  );
}

function DetailRow({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="lpr-history-detail__row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function EventDetailModal({
  tenantId,
  accessToken,
  event,
  onClose,
}: {
  tenantId: string;
  accessToken: string;
  event: LocalLprDetectionEvent;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="confirm-dialog-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        className="lpr-history-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`Evento ${plateOf(event)}`}
      >
        <header className="lpr-history-modal__head">
          <h2>Evento · {plateOf(event)}</h2>
          <button
            type="button"
            className="ghost-button"
            onClick={onClose}
            aria-label="Cerrar"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </header>

        <div className="lpr-history-modal__body">
          <Evidence
            tenantId={tenantId}
            accessToken={accessToken}
            eventId={event.id}
            storagePath={event.imageStoragePath}
            available={hasEvidence(event)}
            plate={plateOf(event)}
            size="full"
          />

          <div className="lpr-history-detail__grid">
            <DetailRow label="Patente" value={plateOf(event)} />
            <DetailRow
              label="Tipo"
              value={DIRECTION_LABEL[directionOf(event)]}
            />
            <DetailRow
              label="Fecha y hora"
              value={formatArgentinaDateTime(event.lastSeenAt)}
            />
            <DetailRow
              label="Primera detección"
              value={formatArgentinaDateTime(event.firstSeenAt)}
            />
            <DetailRow
              label="Confianza OCR"
              value={`${confidencePct(event.confidence)} · ${QUALITY_LABEL[event.qualityStatus]}`}
            />
            <DetailRow
              label="Formato"
              value={`${event.formatType}${event.formatValid ? '' : ' (inválido)'}`}
            />
            <DetailRow label="Estado" value={STATUS_LABEL[event.status]} />
            <DetailRow label="Cámara" value={event.cameraId} />
            <DetailRow label="Ubicación" value={event.location} />
            <DetailRow label="Texto OCR crudo" value={event.rawText ?? '—'} />
            <DetailRow
              label="Texto normalizado"
              value={event.normalizedText ?? '—'}
            />
            <DetailRow
              label="Entrada asociada"
              value={shortId(event.entryId)}
            />
            <DetailRow
              label="Revisado el"
              value={
                event.reviewedAt
                  ? formatArgentinaDateTime(event.reviewedAt)
                  : '—'
              }
            />
            <DetailRow label="ID del evento" value={event.id} />
          </div>
        </div>
      </section>
    </div>
  );
}

export function LprEventHistoryPanel({ tenantId, accessToken }: Props) {
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [plateInput, setPlateInput] = useState('');
  const [direction, setDirection] = useState<DirectionFilter>('todos');
  const [page, setPage] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const events = useLiveQuery(
    () =>
      localDb.lprDetectionEvents
        .where('tenantId')
        .equals(tenantId)
        .toArray()
        .then((rows) =>
          rows.sort(
            (a, b) =>
              new Date(b.lastSeenAt).getTime() -
              new Date(a.lastSeenAt).getTime(),
          ),
        ),
    [tenantId],
  );

  const dateRangeInvalid =
    fromDate !== '' && toDate !== '' && fromDate > toDate;

  const filtered = useMemo(() => {
    if (!events || dateRangeInvalid) return [];
    const fromTs = fromDate ? new Date(`${fromDate}T00:00:00`).getTime() : null;
    const toTs = toDate ? new Date(`${toDate}T23:59:59.999`).getTime() : null;
    const plateQuery = plateInput.trim()
      ? normalizePlateQuery(plateInput.trim())
      : null;

    return events.filter((e) => {
      const ts = new Date(e.lastSeenAt).getTime();
      if (fromTs !== null && ts < fromTs) return false;
      if (toTs !== null && ts > toTs) return false;
      if (
        plateQuery &&
        !(e.normalizedText ?? '').toUpperCase().startsWith(plateQuery)
      ) {
        return false;
      }
      if (direction !== 'todos' && directionOf(e) !== direction) return false;
      return true;
    });
  }, [events, fromDate, toDate, plateInput, direction, dateRangeInvalid]);

  useEffect(() => {
    setPage(0);
  }, [fromDate, toDate, plateInput, direction]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const pageItems = filtered.slice(
    currentPage * PAGE_SIZE,
    currentPage * PAGE_SIZE + PAGE_SIZE,
  );
  const selected = selectedId
    ? (events?.find((e) => e.id === selectedId) ?? null)
    : null;

  const hasActiveFilters =
    fromDate !== '' ||
    toDate !== '' ||
    plateInput.trim() !== '' ||
    direction !== 'todos';

  function clearFilters() {
    setFromDate('');
    setToDate('');
    setPlateInput('');
    setDirection('todos');
  }

  return (
    <div className="lpr-history">
      <div className="lpr-history-filters">
        <label className="form-field">
          <span className="form-label">Desde</span>
          <input
            type="date"
            value={fromDate}
            max={toDate || undefined}
            onChange={(e) => setFromDate(e.target.value)}
          />
        </label>
        <label className="form-field">
          <span className="form-label">Hasta</span>
          <input
            type="date"
            value={toDate}
            min={fromDate || undefined}
            onChange={(e) => setToDate(e.target.value)}
          />
        </label>
        <label className="form-field">
          <span className="form-label">Patente</span>
          <input
            type="text"
            placeholder="Ej. AB123CD"
            value={plateInput}
            onChange={(e) => setPlateInput(e.target.value)}
          />
        </label>
        <label className="form-field">
          <span className="form-label">Tipo</span>
          <select
            value={direction}
            onChange={(e) => setDirection(e.target.value as DirectionFilter)}
          >
            <option value="todos">Todos</option>
            <option value="ingreso">Ingreso</option>
            <option value="egreso">Egreso</option>
          </select>
        </label>
        {hasActiveFilters && (
          <button
            type="button"
            className="ghost-button lpr-history-clear"
            onClick={clearFilters}
          >
            <X size={14} aria-hidden="true" />
            Limpiar
          </button>
        )}
      </div>

      {dateRangeInvalid && (
        <p className="field-error">
          La fecha «Desde» no puede ser posterior a «Hasta».
        </p>
      )}

      {events === undefined ? (
        <p className="muted">Cargando eventos…</p>
      ) : filtered.length === 0 ? (
        <div className="lpr-history-empty">
          <Search size={28} aria-hidden="true" />
          <p>
            {hasActiveFilters
              ? 'Ningún evento coincide con los filtros.'
              : 'Todavía no hay eventos de cámara registrados.'}
          </p>
        </div>
      ) : (
        <>
          <p className="lpr-history-summary muted">
            {filtered.length} evento{filtered.length === 1 ? '' : 's'}
            {hasActiveFilters ? ' (filtrados)' : ''}
          </p>

          <div className="lpr-history-grid">
            {pageItems.map((event) => (
              <EventCard
                key={event.id}
                tenantId={tenantId}
                accessToken={accessToken}
                event={event}
                onOpen={setSelectedId}
              />
            ))}
          </div>

          {pageCount > 1 && (
            <div className="lpr-history-pagination">
              <button
                type="button"
                className="ghost-button"
                disabled={currentPage <= 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
              >
                <ChevronLeft size={15} aria-hidden="true" />
                Anterior
              </button>
              <span className="muted">
                Página {currentPage + 1} de {pageCount}
              </span>
              <button
                type="button"
                className="ghost-button"
                disabled={currentPage >= pageCount - 1}
                onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
              >
                Siguiente
                <ChevronRight size={15} aria-hidden="true" />
              </button>
            </div>
          )}
        </>
      )}

      {selected && (
        <EventDetailModal
          tenantId={tenantId}
          accessToken={accessToken}
          event={selected}
          onClose={() => setSelectedId(null)}
        />
      )}
    </div>
  );
}
