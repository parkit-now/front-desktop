import { Minus, Plus, RotateCcw, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { plateOverlayStyle } from './plateBbox';
import { CAMERA_BASE_URL, type PendingDetection } from './useCameraDetections';

interface Props {
  detection: PendingDetection;
  onClose: () => void;
}

/**
 * La foto completa del área vigilada, para ver QUÉ vehículo entró.
 *
 * La tarjeta muestra el recorte de la patente, que es lo que la hace legible a
 * 260 px de ancho. Pero con ese recorte el operador no puede confirmar marca,
 * modelo ni color, que es justo lo que necesita cuando la lectura es dudosa o
 * cuando hay que reclamar algo después.
 *
 * Pide la imagen SIN parámetros de compresión: el archivo está en el disco de
 * este mismo equipo, así que acá se muestra en calidad original. La versión
 * liviana es sólo para lo que se sube a la nube.
 */
const ZOOM_MIN = 1;
const ZOOM_MAX = 4;
const ZOOM_STEP = 0.25;

function clampZoom(value: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value));
}

export function DetectionImageDialog({ detection, onClose }: Props) {
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    panX: number;
    panY: number;
  } | null>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  function updateZoom(delta: number, point?: { x: number; y: number }) {
    const next = clampZoom(zoom + delta);
    if (next === zoom) return;

    const rect = frameRef.current?.getBoundingClientRect();
    const origin = rect
      ? {
          x: point ? point.x - rect.left : rect.width / 2,
          y: point ? point.y - rect.top : rect.height / 2,
        }
      : null;

    if (next === 1 || !origin) {
      setPan({ x: 0, y: 0 });
      setZoom(next);
      return;
    }

    setPan((current) => ({
      x: origin.x - ((origin.x - current.x) / zoom) * next,
      y: origin.y - ((origin.y - current.y) / zoom) * next,
    }));
    setZoom(next);
  }

  function resetZoom() {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }

  useEffect(() => {
    // Devolverle el foco a quien abrió el diálogo. Sin esto, al cerrar el foco
    // queda en <body> y el operador pierde el lugar en el tab-order — se nota
    // enseguida en un visor que se abre y se cierra todo el tiempo.
    const trigger = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => trigger?.focus?.();
  }, []);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;

    // El listener se registra a mano, y no con `onWheel`, porque React adjunta
    // `wheel` en la raíz como PASSIVE (desde la v17, y esto corre sobre la 19).
    // Ahí adentro `preventDefault()` no hace nada: el zoom funcionaba, pero el
    // panel de atrás scrolleaba al mismo tiempo y la consola avisaba que no se
    // podía prevenir. Sólo un listener no-passive puede frenar el scroll.
    function onWheel(event: WheelEvent) {
      event.preventDefault();
      updateZoom(event.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP, {
        x: event.clientX,
        y: event.clientY,
      });
    }

    frame.addEventListener('wheel', onWheel, { passive: false });
    return () => frame.removeEventListener('wheel', onWheel);
    // `updateZoom` lee `zoom` de la clausura, así que hay que reatar el
    // listener cuando cambia. `failed` y `retry` remontan el marco.
  }, [zoom, failed, retry]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const confidencePct = Math.round(detection.confidence * 100);
  const detectedAtLabel = new Date(detection.firstSeenAt).toLocaleTimeString(
    'es-AR',
    { hour: '2-digit', minute: '2-digit', hour12: false },
  );
  const plate = detection.displayPlate || detection.normalizedText || '';

  return (
    <div
      className="rate-dialog-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={`Imagen de la detección ${plate}`}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="detection-image-dialog">
        <header className="detection-image-dialog__header">
          <div>
            <strong>{plate}</strong>
            <span>
              {detectedAtLabel} · {confidencePct}% de confianza
            </span>
          </div>
          <div className="detection-image-dialog__actions">
            {!failed && detection.bestCaptureId ? (
              <div
                className="detection-image-dialog__zoom-controls"
                aria-label="Zoom de imagen"
              >
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => updateZoom(-ZOOM_STEP)}
                  disabled={zoom <= ZOOM_MIN}
                  aria-label="Alejar"
                >
                  <Minus size={17} aria-hidden="true" />
                </button>
                <span>{Math.round(zoom * 100)}%</span>
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => updateZoom(ZOOM_STEP)}
                  disabled={zoom >= ZOOM_MAX}
                  aria-label="Acercar"
                >
                  <Plus size={17} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="ghost-button"
                  onClick={resetZoom}
                  disabled={zoom === 1}
                  aria-label="Restablecer zoom"
                >
                  <RotateCcw size={17} aria-hidden="true" />
                </button>
              </div>
            ) : null}
            <button
              ref={closeRef}
              type="button"
              className="ghost-button"
              onClick={onClose}
              aria-label="Cerrar"
            >
              <X size={20} aria-hidden="true" />
            </button>
          </div>
        </header>

        {failed || !detection.bestCaptureId ? (
          <div className="detection-image-dialog__error">
            <p>No se pudo cargar la imagen.</p>
            <button
              type="button"
              className="ghost-button"
              onClick={() => {
                setFailed(false);
                setRetry((n) => n + 1);
              }}
            >
              Reintentar
            </button>
          </div>
        ) : (
          <div
            ref={frameRef}
            className={`detection-image-dialog__frame${zoom > 1 ? ' is-pannable' : ''}${dragging ? ' is-dragging' : ''}`}
            onPointerDown={(event) => {
              if (zoom <= 1 || event.button !== 0) return;
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
              if (!drag || drag.pointerId !== event.pointerId) return;
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
            <div
              className="detection-image-dialog__stage"
              style={{
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              }}
            >
              <img
                key={retry}
                src={`${CAMERA_BASE_URL}/capture/${encodeURIComponent(detection.bestCaptureId)}/image.jpg`}
                alt={`Vehículo de la detección ${plate}`}
                onError={() => setFailed(true)}
                draggable={false}
              />
              {/* El recuadro va por CSS y no quemado en el JPEG: los mismos
                  bytes se suben a la nube, y un recuadro dibujado quedaría
                  fuera de lugar en cualquier recorte posterior. Los
                  porcentajes salen directo del bbox normalizado, sin tener
                  que convertir a píxeles. */}
              {detection.plateBbox ? (
                <div
                  className="detection-image-dialog__plate"
                  style={plateOverlayStyle(detection.plateBbox)}
                  aria-hidden="true"
                />
              ) : null}
            </div>
          </div>
        )}

        <footer className="detection-image-dialog__footer">
          Presioná Esc para cerrar · Rueda para zoom · Arrastrá para mover
        </footer>
      </div>
    </div>
  );
}
