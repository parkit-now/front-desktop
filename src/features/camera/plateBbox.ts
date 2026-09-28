import type { PlateBbox } from '../../lib/db/localDb';

export type { PlateBbox };

function isFraction(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1
  );
}

/**
 * Valida el bbox que viene del servicio de cámara o del backend.
 *
 * `undefined` no significa «falta el dato»: significa que la imagen de ese
 * evento es del formato viejo —el recorte de la patente, con el recuadro ya
 * dibujado— y que **no hay que volver a recortarla**.
 *
 * Por eso conviene ser estricto acá: un bbox basura que se colara haría que la
 * app recorte un recorte, y lo que se vería es un puñado de píxeles.
 */
export function parsePlateBbox(value: unknown): PlateBbox | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const { x, y, w, h } = value as Record<string, unknown>;
  if (!isFraction(x) || !isFraction(y) || !isFraction(w) || !isFraction(h)) {
    return undefined;
  }
  if (w <= 0 || h <= 0) return undefined;
  return { x, y, w, h };
}

/**
 * Porcentaje sin la cola de punto flotante: `0.5 * 100` puede dar
 * `50.000000000000014`, y eso termina tal cual en el `style` del DOM.
 */
function pct(fraction: number): string {
  return `${Number((fraction * 100).toFixed(4))}%`;
}

/** Estilo del recuadro verde encima de la imagen, en porcentajes. */
export function plateOverlayStyle(bbox: PlateBbox): {
  left: string;
  top: string;
  width: string;
  height: string;
} {
  return {
    left: pct(bbox.x),
    top: pct(bbox.y),
    width: pct(bbox.w),
    height: pct(bbox.h),
  };
}
