import { useEffect, useState } from 'react';
import { CAMERA_BASE_URL } from '../../lib/camera/constants';

const POLL_MS = 10_000;

interface RawStatus {
  camera: string;
  down_since: string | null;
  reconnect_attempts: number;
  /** Fuente en uso, con la contraseña ya enmascarada por el servicio. */
  source?: string | null;
}

export interface CameraStatus {
  /**
   * `initializing` = el servicio arrancó pero todavía no abrió la cámara.
   *
   * Antes se colapsaba a `down` y la UI decía "Sin señal" en cada arranque.
   * Con una webcam USB duraba un instante; con una cámara IP la apertura lleva
   * segundos, así que el operador veía un error donde no lo había.
   */
  camera: 'ok' | 'down' | 'initializing';
  downSince: Date | null;
  reconnectAttempts: number;
  /** Ya viene redactada del servicio: mostrarla es seguro. */
  source: string | null;
}

function normalizeCamera(raw: string): CameraStatus['camera'] {
  if (raw === 'ok') return 'ok';
  if (raw === 'initializing') return 'initializing';
  return 'down';
}

export function useCameraStatus(): CameraStatus | null {
  const [status, setStatus] = useState<CameraStatus | null>(null);

  useEffect(() => {
    async function poll() {
      try {
        const res = await fetch(`${CAMERA_BASE_URL}/stream/status`);
        if (!res.ok) return;
        const raw = (await res.json()) as RawStatus;
        setStatus({
          camera: normalizeCamera(raw.camera),
          downSince: raw.down_since ? new Date(raw.down_since) : null,
          reconnectAttempts: raw.reconnect_attempts,
          source: raw.source ?? null,
        });
      } catch {
        // Service unreachable — service-level failures are handled via the
        // IPC onServicesFailed / onServiceCrashed bridge, not here.
      }
    }

    void poll();
    const id = setInterval(() => void poll(), POLL_MS);
    return () => clearInterval(id);
  }, []);

  return status;
}
