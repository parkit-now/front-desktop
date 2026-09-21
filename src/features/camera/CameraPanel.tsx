import { Cctv, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { CAMERA_BASE_URL } from '../../lib/camera/constants';
import { useCameraStatus } from './useCameraStatus';

export function CameraPanel() {
  const status = useCameraStatus();
  const [streamKey, setStreamKey] = useState(() => Date.now());
  const [errored, setErrored] = useState(false);

  const isDown = status?.camera === 'down';
  const isConnecting = status?.camera === 'initializing';
  const showPlaceholder = isDown || isConnecting || errored;

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
              {isConnecting
                ? 'Conectando con la cámara...'
                : isDown
                  ? 'Cámara desconectada'
                  : 'No se pudo cargar el video en vivo'}
            </p>
            {/* La fuente llega redactada del servicio (sin la contraseña), y es
                lo único que convierte un "Sin señal" mudo en algo accionable:
                dice contra qué dirección está fallando. */}
            {!isConnecting && status?.source ? (
              <p className="camera-panel__source muted">{status.source}</p>
            ) : null}
            {!isConnecting ? (
              <button type="button" className="ghost-button" onClick={reload}>
                <RefreshCw size={16} aria-hidden="true" />
                Reintentar
              </button>
            ) : null}
          </div>
        ) : (
          <img
            key={streamKey}
            className="camera-panel__video"
            src={`${CAMERA_BASE_URL}/stream/mjpeg?t=${streamKey}`}
            alt="Video en vivo de la cámara"
            onError={() => setErrored(true)}
          />
        )}

        <span
          className={`camera-panel__badge ${isDown || isConnecting ? 'down' : 'live'}`}
          aria-hidden="true"
        >
          <span className="camera-panel__dot" />
          {isConnecting ? 'Conectando' : isDown ? 'Sin señal' : 'En vivo'}
        </span>
      </div>

      <p className="camera-panel__hint muted">
        Las patentes detectadas se registran automáticamente en el panel
        Operativo.
      </p>
    </section>
  );
}
