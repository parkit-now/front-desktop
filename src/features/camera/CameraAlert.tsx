import { useEffect, useState } from 'react';
import { useCameraStatus } from './useCameraStatus';

const ALERT_AFTER_MS = 60_000;
const TICK_MS = 1_000;

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}min`;
}

export function CameraAlert() {
  const status = useCameraStatus();
  const [now, setNow] = useState(() => Date.now());

  // Tick every second while the camera is down so elapsed time stays live
  // instead of freezing between 10 s poll cycles.
  useEffect(() => {
    if (!status || status.camera === 'ok') return;
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, [status?.camera]);

  if (!status || status.camera === 'ok') return null;

  const elapsedMs = status.downSince ? now - status.downSince.getTime() : 0;

  if (elapsedMs < ALERT_AFTER_MS) return null;

  const duration = status.downSince ? formatDuration(elapsedMs) : null;

  return (
    <div className="camera-alert" role="alert">
      <span className="camera-alert__icon" aria-hidden="true">
        ⚠
      </span>
      <p className="camera-alert__message">
        Cámara desconectada
        {duration != null && ` · hace ${duration}`}
        {status.reconnectAttempts > 0 &&
          ` · reconectando (intento ${status.reconnectAttempts})`}
      </p>
    </div>
  );
}
