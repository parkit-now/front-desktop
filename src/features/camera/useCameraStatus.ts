import { useEffect, useState } from 'react';

const CAMERA_URL = 'http://127.0.0.1:8766';
const POLL_MS = 10_000;

interface RawStatus {
  camera: string;
  down_since: string | null;
  reconnect_attempts: number;
}

export interface CameraStatus {
  camera: 'ok' | 'down';
  downSince: Date | null;
  reconnectAttempts: number;
}

export function useCameraStatus(): CameraStatus | null {
  const [status, setStatus] = useState<CameraStatus | null>(null);

  useEffect(() => {
    async function poll() {
      try {
        const res = await fetch(`${CAMERA_URL}/stream/status`);
        if (!res.ok) return;
        const raw = (await res.json()) as RawStatus;
        setStatus({
          camera: raw.camera === 'ok' ? 'ok' : 'down',
          downSince: raw.down_since ? new Date(raw.down_since) : null,
          reconnectAttempts: raw.reconnect_attempts,
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
