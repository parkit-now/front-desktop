import { ArrowLeft, Cctv, RefreshCw, Settings } from 'lucide-react';
import { useState } from 'react';
import { CAMERA_BASE_URL } from '../../lib/camera/constants';
import type { DesktopServiceName } from '../system/useDesktopServiceFailures';
import { CameraSettingsPanel } from './CameraSettingsPanel';
import { useCameraStatus } from './useCameraStatus';
import { MjpegImage } from './MjpegImage';

type Props = {
  tenantId?: string | null;
  accessToken?: string | null;
  /** Dueño/admin: ve el engranaje que abre la configuración de la cámara. */
  canConfigure?: boolean;
  failedServices?: readonly DesktopServiceName[];
};

export function CameraPanel({
  tenantId = null,
  accessToken = null,
  canConfigure = false,
  failedServices = [],
}: Props) {
  const [showSettings, setShowSettings] = useState(false);
  // Perder el permiso (cambio de estacionamiento) cierra la sub-vista.
  const settingsOpen = showSettings && canConfigure;

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

  if (settingsOpen) {
    return (
      <section className="camera-panel">
        <div className="camera-panel__toolbar">
          <button
            type="button"
            className="ghost-button"
            onClick={() => setShowSettings(false)}
          >
            <ArrowLeft size={16} aria-hidden="true" />
            Volver a la cámara
          </button>
        </div>
        <CameraSettingsPanel
          tenantId={tenantId}
          accessToken={accessToken}
          failedServices={failedServices}
        />
      </section>
    );
  }

  return (
    <section className="camera-panel">
      {canConfigure ? (
        <div className="camera-panel__toolbar camera-panel__toolbar--end">
          <button
            type="button"
            className="ghost-button camera-panel__gear"
            onClick={() => setShowSettings(true)}
            aria-label="Configurar cámara"
            title="Configurar cámara"
          >
            <Settings size={18} aria-hidden="true" />
          </button>
        </div>
      ) : null}
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
          <MjpegImage
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
