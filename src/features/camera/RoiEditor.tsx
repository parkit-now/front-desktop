import { useCallback, useRef, useState } from 'react';
import { CAMERA_BASE_URL } from '../../lib/camera/constants';

export type Roi = [number, number, number, number];

interface Props {
  value: Roi | null;
  onChange: (roi: Roi | null) => void;
}

/**
 * Dibuja la zona de detección arrastrando sobre el video en vivo.
 *
 * POR QUÉ NO ALCANZAN CUATRO CAMPOS NUMÉRICOS
 *
 * El ROI son coordenadas en píxeles del frame original — 2560x1440 en una
 * cámara de 4MP. Pedirlos a mano obliga al instalador a estimar a ojo sobre una
 * imagen escalada y corregir por prueba y error, justo cuando está arriba de una
 * escalera. Arrastrando sobre la imagen, lo que ve es lo que queda.
 *
 * LA CONVERSIÓN QUE HAY QUE HACER BIEN
 *
 * El `<img>` se muestra escalado, así que un click en pantalla no es un píxel
 * del frame. `naturalWidth`/`naturalHeight` dan el tamaño real del frame que
 * está llegando (el navegador lo sabe incluso en un MJPEG), y con eso se
 * convierte. Sin esa conversión, el ROI quedaría corrido y recortando la zona
 * equivocada — un error que después es muy difícil de atribuir.
 */
export function RoiEditor({ value, onChange }: Props) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [drag, setDrag] = useState<{
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  } | null>(null);
  const [streamKey, setStreamKey] = useState(() => Date.now());
  const [errored, setErrored] = useState(false);

  /** Coordenadas del evento, relativas a la imagen mostrada (0-1). */
  const relative = useCallback(
    (event: React.PointerEvent): { x: number; y: number } => {
      const rect = event.currentTarget.getBoundingClientRect();
      return {
        x: Math.min(Math.max((event.clientX - rect.left) / rect.width, 0), 1),
        y: Math.min(Math.max((event.clientY - rect.top) / rect.height, 0), 1),
      };
    },
    [],
  );

  function handleDown(event: React.PointerEvent): void {
    event.currentTarget.setPointerCapture(event.pointerId);
    const { x, y } = relative(event);
    setDrag({ x1: x, y1: y, x2: x, y2: y });
  }

  function handleMove(event: React.PointerEvent): void {
    if (!drag) return;
    const { x, y } = relative(event);
    setDrag({ ...drag, x2: x, y2: y });
  }

  function handleUp(): void {
    if (!drag) return;
    const img = imgRef.current;
    const w = img?.naturalWidth ?? 0;
    const h = img?.naturalHeight ?? 0;
    setDrag(null);
    if (!w || !h) return;

    const x1 = Math.round(Math.min(drag.x1, drag.x2) * w);
    const y1 = Math.round(Math.min(drag.y1, drag.y2) * h);
    const x2 = Math.round(Math.max(drag.x1, drag.x2) * w);
    const y2 = Math.round(Math.max(drag.y1, drag.y2) * h);

    // Un click sin arrastrar no es una zona: sería un ROI de cero píxeles y el
    // servicio lo rechazaría con un error que el usuario no esperaba.
    if (x2 - x1 < 20 || y2 - y1 < 20) return;
    onChange([x1, y1, x2, y2]);
  }

  // El rectángulo a pintar: el que se está arrastrando, o el guardado.
  const img = imgRef.current;
  const natW = img?.naturalWidth ?? 0;
  const natH = img?.naturalHeight ?? 0;
  const box = drag
    ? {
        left: `${Math.min(drag.x1, drag.x2) * 100}%`,
        top: `${Math.min(drag.y1, drag.y2) * 100}%`,
        width: `${Math.abs(drag.x2 - drag.x1) * 100}%`,
        height: `${Math.abs(drag.y2 - drag.y1) * 100}%`,
      }
    : value && natW && natH
      ? {
          left: `${(value[0] / natW) * 100}%`,
          top: `${(value[1] / natH) * 100}%`,
          width: `${((value[2] - value[0]) / natW) * 100}%`,
          height: `${((value[3] - value[1]) / natH) * 100}%`,
        }
      : null;

  return (
    <div className="roi-editor">
      {errored ? (
        <div className="roi-editor__placeholder">
          <p className="muted">
            No hay video para dibujar la zona. Configurá y guardá la cámara
            primero.
          </p>
          <button
            type="button"
            className="ghost-button compact"
            onClick={() => {
              setErrored(false);
              setStreamKey(Date.now());
            }}
          >
            Reintentar
          </button>
        </div>
      ) : (
        <div
          className="roi-editor__stage"
          onPointerDown={handleDown}
          onPointerMove={handleMove}
          onPointerUp={handleUp}
        >
          <img
            ref={imgRef}
            key={streamKey}
            className="roi-editor__video"
            src={`${CAMERA_BASE_URL}/stream/mjpeg?roi=${streamKey}`}
            alt="Video en vivo para delimitar la zona de detección"
            draggable={false}
            onError={() => setErrored(true)}
          />
          {box ? <div className="roi-editor__box" style={box} /> : null}
        </div>
      )}

      <div className="roi-editor__actions">
        <p className="muted printer-panel-hint">
          {value
            ? `Zona activa: ${value[2] - value[0]}×${value[3] - value[1]} px. Arrastrá para redibujarla.`
            : 'Arrastrá sobre la imagen para marcar la boca del portón. Fuera de esa zona no se analiza nada.'}
        </p>
        {value ? (
          <button
            type="button"
            className="ghost-button compact"
            onClick={() => onChange(null)}
          >
            Usar todo el cuadro
          </button>
        ) : null}
      </div>
    </div>
  );
}
