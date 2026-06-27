import { Cctv, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { useCameraStatus } from './useCameraStatus';

const CAMERA_URL = 'http://127.0.0.1:8766';

export function CameraPanel() {
  const status = useCameraStatus();
  const [streamKey, setStreamKey] = useState(() => Date.now());
  const [errored, setErrored] = useState(false);

  const isDown = status?.camera === 'down';
  const showPlaceholder = isDown || errored;

  function reload() {
    setErrored(false);
    setStreamKey(Date.now());
  }

  return (
    <section className="camera-panel">
      <div className="camera-panel__viewport">
        {showPlaceholder ? (
          <div className="camera-panel__placeholder">
            <Cctv size={48} aria-hidden="true" />
            <p>
              {isDown
                ? 'Cámara desconectada'
                : 'No se pudo cargar el video en vivo'}
            </p>
            <button type="button" className="ghost-button" onClick={reload}>
              <RefreshCw size={16} aria-hidden="true" />
              Reintentar
            </button>
          </div>
        ) : (
          <img
            key={streamKey}
            className="camera-panel__video"
            src={`${CAMERA_URL}/stream/mjpeg?t=${streamKey}`}
            alt="Video en vivo de la cámara"
            onError={() => setErrored(true)}
          />
        )}

        <span
          className={`camera-panel__badge ${isDown ? 'down' : 'live'}`}
          aria-hidden="true"
        >
          <span className="camera-panel__dot" />
          {isDown ? 'Sin señal' : 'En vivo'}
        </span>
      </div>

      <p className="camera-panel__hint muted">
        Las patentes detectadas se registran automáticamente en el panel
        Operativo.
      </p>
    </section>
  );
}
