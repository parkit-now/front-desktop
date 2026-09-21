import { PlugZap, RefreshCcw, Save } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useToast } from '../../lib/notifications/ToastProvider';
import { AppSelect } from '../../lib/ui/AppSelect';
import { Switch } from '../../lib/ui/Switch';
import { useWebcamDevices } from './useWebcamDevices';
import { useCameraStatus } from './useCameraStatus';

/**
 * De dónde saca el video el servicio de detección de patentes.
 *
 * Por qué los datos de la cámara IP se piden separados y no como una URL: una
 * URL RTSP lleva la contraseña adentro (`rtsp://admin:clave@host:554/stream`),
 * así que pedirla entera obliga al dueño a tenerla a la vista para tipearla y la
 * deja en el portapapeles. Además un error de tipeo en el medio de esa cadena es
 * imposible de diagnosticar mirando la pantalla. La URL la arma el proceso main.
 */

const DEFAULT_PORT = 554;
const DEFAULT_STREAM_PATH = '/h264_stream';

const PROBE_ERRORS: Record<string, string> = {
  falta_direccion: 'Falta la dirección IP de la cámara.',
  no_se_pudo_conectar:
    'No se pudo conectar. Revisá la IP, el puerto, el usuario y la contraseña, y que la cámara esté encendida.',
  conecta_pero_no_entrega_video:
    'La cámara responde pero no entrega video. Suele ser la ruta del stream mal escrita, o el cifrado de imagen activado en la cámara.',
  servicio_no_disponible:
    'El servicio de cámara no está corriendo. Reiniciá la aplicación.',
};

type ProbeState =
  | { kind: 'idle' }
  | { kind: 'probing' }
  | { kind: 'ok'; width: number; height: number }
  | { kind: 'info'; message: string }
  | { kind: 'error'; message: string };

export function CameraSettingsPanel() {
  const { showToast } = useToast();
  const status = useCameraStatus();
  const [bridgeMissing, setBridgeMissing] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [probe, setProbe] = useState<ProbeState>({ kind: 'idle' });

  const [useWebcam, setUseWebcam] = useState(true);
  const [deviceIndex, setDeviceIndex] = useState(0);
  const [host, setHost] = useState('');
  const [port, setPort] = useState(String(DEFAULT_PORT));
  const [username, setUsername] = useState('');
  const [streamPath, setStreamPath] = useState(DEFAULT_STREAM_PATH);
  const [cameraId, setCameraId] = useState('');
  // `null` = no se tocó, hay que conservar la guardada. `''` = borrarla.
  const [password, setPassword] = useState<string | null>(null);
  const [hasStoredPassword, setHasStoredPassword] = useState(false);

  const webcams = useWebcamDevices(useWebcam);

  useEffect(() => {
    const bridge = window.parkitDesktop;
    if (!bridge || typeof bridge.getCameraConfig !== 'function') {
      setBridgeMissing(true);
      return;
    }
    let mounted = true;
    void bridge
      .getCameraConfig()
      .then((config) => {
        if (!mounted) return;
        setUseWebcam(config.mode === 'webcam');
        setDeviceIndex(config.deviceIndex);
        setHost(config.host);
        setPort(String(config.port));
        setUsername(config.username);
        setStreamPath(config.streamPath);
        setCameraId(config.cameraId);
        setHasStoredPassword(config.hasPassword);
        setLoaded(true);
      })
      .catch(() => {
        if (mounted) setLoaded(true);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const buildInput = useCallback((): DesktopCameraConfigInput => {
    const parsedPort = Number(port);
    return {
      mode: useWebcam ? 'webcam' : 'ip',
      deviceIndex,
      host: host.trim(),
      port:
        Number.isFinite(parsedPort) && parsedPort > 0 && parsedPort <= 65535
          ? parsedPort
          : DEFAULT_PORT,
      username: username.trim(),
      streamPath: streamPath.trim() || DEFAULT_STREAM_PATH,
      cameraId: cameraId.trim(),
      location: 'entrada',
      // Omitir la clave cuando no se tocó es lo que permite cambiar de modo, o
      // editar cualquier otro campo, sin tener que volver a escribirla.
      ...(password === null ? {} : { password }),
    };
  }, [
    cameraId,
    deviceIndex,
    host,
    password,
    port,
    streamPath,
    useWebcam,
    username,
  ]);

  async function handleProbe(): Promise<void> {
    const bridge = window.parkitDesktop;
    if (!bridge) return;

    // Probar la webcam que el servicio YA tiene abierta falla por dispositivo
    // ocupado, no porque la cámara ande mal. Reportar ese error haría dudar de
    // una cámara sana, así que se responde con lo que realmente pasa.
    if (
      useWebcam &&
      status?.camera === 'ok' &&
      status.source === String(deviceIndex)
    ) {
      setProbe({
        kind: 'info',
        message: 'Es la cámara que está funcionando ahora mismo.',
      });
      return;
    }

    setProbe({ kind: 'probing' });
    const result = await bridge.probeCamera(buildInput());
    setProbe(
      result.ok
        ? { kind: 'ok', width: result.width, height: result.height }
        : {
            kind: 'error',
            message: PROBE_ERRORS[result.error] ?? 'No se pudo conectar.',
          },
    );
  }

  async function handleSave(): Promise<void> {
    const bridge = window.parkitDesktop;
    if (!bridge) return;
    setSaving(true);
    try {
      const result = await bridge.setCameraConfig(buildInput());
      if (password !== null) {
        setHasStoredPassword(password.length > 0);
        setPassword(null);
      }
      setProbe({ kind: 'idle' });
      showToast({
        message: result.reconnected
          ? 'Cámara guardada y reconectada.'
          : 'Cámara guardada. Se va a usar al reiniciar la aplicación.',
        kind: 'success',
      });
    } finally {
      setSaving(false);
    }
  }

  if (bridgeMissing) {
    return (
      <section className="dashboard-card warning">
        <h2>Configuración no disponible</h2>
        <p className="muted">
          La cámara solo se configura desde la app de escritorio.
        </p>
      </section>
    );
  }

  const canSubmit = (useWebcam || host.trim().length > 0) && !saving;

  return (
    <div className="printer-panel">
      <section className="dashboard-card">
        <h2>Cámara de la entrada</h2>
        <p className="muted">
          De acá saca el video la detección automática de patentes. Es una
          configuración de esta computadora: la dirección y la contraseña no
          salen de acá.
        </p>

        {!loaded ? (
          <p className="muted">Cargando configuración...</p>
        ) : (
          <>
            <div className="camera-mode-row">
              <Switch
                checked={useWebcam}
                onChange={(checked) => {
                  setUseWebcam(checked);
                  setProbe({ kind: 'idle' });
                }}
                label="Usar la webcam de esta computadora"
              />
              <p className="muted printer-panel-hint">
                Apagalo para usar una cámara IP por red. Los datos que cargues
                de la cámara IP se conservan aunque vuelvas a la webcam.
              </p>
            </div>

            {useWebcam ? (
              <>
                <div className="printer-panel-field">
                  <label className="form-label" htmlFor="camera-device">
                    Cámara
                  </label>
                  {webcams.loading ? (
                    <p className="muted">Buscando cámaras...</p>
                  ) : webcams.devices.length === 0 ? (
                    <p className="csd-note csd-note--warning">
                      No se detectó ninguna webcam en esta computadora.
                    </p>
                  ) : (
                    <AppSelect
                      id="camera-device"
                      value={String(deviceIndex)}
                      onChange={(value) => setDeviceIndex(Number(value))}
                      options={webcams.devices.map((device) => ({
                        value: String(device.index),
                        label: device.label,
                      }))}
                    />
                  )}
                  <p className="muted printer-panel-hint">
                    {webcams.labelled
                      ? 'Si tenés más de una cámara y no estás seguro de cuál es, usá "Probar" para confirmarlo.'
                      : 'No se pudieron leer los nombres porque la webcam está en uso por la detección. Apagá este switch, guardá, y volvé: ahí aparecen los nombres reales.'}
                  </p>
                </div>

                <div className="printer-panel-field">
                  <label className="form-label" htmlFor="camera-id-webcam">
                    Identificador
                  </label>
                  <input
                    id="camera-id-webcam"
                    type="text"
                    placeholder="cam-entrada"
                    value={cameraId}
                    onChange={(event) => setCameraId(event.target.value)}
                  />
                </div>
              </>
            ) : (
              <>
                <div className="camera-settings-grid">
                  <div className="printer-panel-field">
                    <label className="form-label" htmlFor="camera-host">
                      Dirección IP
                    </label>
                    <input
                      id="camera-host"
                      type="text"
                      placeholder="192.168.1.26"
                      value={host}
                      onChange={(event) => setHost(event.target.value)}
                    />
                  </div>

                  <div className="printer-panel-field">
                    <label className="form-label" htmlFor="camera-port">
                      Puerto
                    </label>
                    <input
                      id="camera-port"
                      type="text"
                      inputMode="numeric"
                      placeholder="554"
                      value={port}
                      onChange={(event) => setPort(event.target.value)}
                    />
                  </div>

                  <div className="printer-panel-field">
                    <label className="form-label" htmlFor="camera-user">
                      Usuario
                    </label>
                    <input
                      id="camera-user"
                      type="text"
                      placeholder="admin"
                      value={username}
                      onChange={(event) => setUsername(event.target.value)}
                    />
                  </div>

                  <div className="printer-panel-field">
                    <label className="form-label" htmlFor="camera-password">
                      Contraseña
                    </label>
                    <input
                      id="camera-password"
                      type="password"
                      placeholder={
                        hasStoredPassword && password === null
                          ? '•••••••• (guardada)'
                          : 'Contraseña de la cámara'
                      }
                      value={password ?? ''}
                      onChange={(event) => setPassword(event.target.value)}
                    />
                  </div>

                  <div className="printer-panel-field">
                    <label className="form-label" htmlFor="camera-path">
                      Ruta del stream
                    </label>
                    <input
                      id="camera-path"
                      type="text"
                      placeholder={DEFAULT_STREAM_PATH}
                      value={streamPath}
                      onChange={(event) => setStreamPath(event.target.value)}
                    />
                  </div>

                  <div className="printer-panel-field">
                    <label className="form-label" htmlFor="camera-id">
                      Identificador
                    </label>
                    <input
                      id="camera-id"
                      type="text"
                      placeholder="cam-entrada"
                      value={cameraId}
                      onChange={(event) => setCameraId(event.target.value)}
                    />
                  </div>
                </div>

                <p className="muted printer-panel-hint">
                  La ruta del stream la publica cada marca distinto. Si la
                  cámara conecta pero no se ve video, casi siempre es eso — o el
                  cifrado de imagen, que hay que desactivar desde la app del
                  fabricante.
                </p>
              </>
            )}

            {probe.kind === 'ok' ? (
              <p className="csd-note">
                Conecta correctamente · video de {probe.width}×{probe.height}
              </p>
            ) : null}
            {probe.kind === 'info' ? (
              <p className="csd-note">{probe.message}</p>
            ) : null}
            {probe.kind === 'error' ? (
              <p className="csd-note csd-note--warning">{probe.message}</p>
            ) : null}

            <div className="printer-panel-actions">
              {useWebcam ? (
                <button
                  type="button"
                  className="ghost-button compact"
                  onClick={webcams.refresh}
                  disabled={webcams.loading}
                >
                  <RefreshCcw size={15} aria-hidden="true" />
                  Actualizar lista
                </button>
              ) : null}
              <button
                type="button"
                className="ghost-button compact"
                onClick={() => void handleProbe()}
                disabled={
                  probe.kind === 'probing' ||
                  (useWebcam
                    ? webcams.devices.length === 0
                    : host.trim().length === 0)
                }
              >
                <PlugZap size={15} aria-hidden="true" />
                {probe.kind === 'probing' ? 'Probando...' : 'Probar conexión'}
              </button>
              <button
                type="button"
                className="primary-button compact"
                onClick={() => void handleSave()}
                disabled={!canSubmit}
              >
                <Save size={15} aria-hidden="true" />
                {saving ? 'Guardando...' : 'Guardar y reconectar'}
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
