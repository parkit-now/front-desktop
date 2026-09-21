import {
  Camera,
  Cctv,
  PlugZap,
  RefreshCcw,
  RotateCcw,
  Save,
  SlidersHorizontal,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useToast } from '../../lib/notifications/ToastProvider';
import { ConfirmDialog } from '../../lib/ui/ConfirmDialog';
import { AppSelect } from '../../lib/ui/AppSelect';
import { useWebcamDevices } from './useWebcamDevices';
import { useCameraStatus } from './useCameraStatus';
import { RoiEditor } from './RoiEditor';
import {
  DEFAULT_CAMERA_PORT,
  DEFAULT_STREAM_PATH,
  advancedFieldsForMode,
  cameraDefaultsForMode,
  cameraSourceSignature,
  deriveCameraId,
  shouldAutoReplaceCameraId,
  type CameraAdvancedField,
} from './cameraSettingsUtils';

const CAMPOS_BASICOS: {
  key: keyof DesktopCameraTuning;
  label: string;
  step: number;
  hint: string;
}[] = [
  {
    key: 'motionCooldown',
    label: 'Segundos entre análisis',
    step: 0.5,
    hint: 'Más bajo = más intentos por auto. Útil si entran rápido.',
  },
  {
    key: 'motionThreshold',
    label: 'Sensibilidad al movimiento',
    step: 0.5,
    hint: 'Más bajo = más sensible. Subilo si dispara con sombras o lluvia.',
  },
  {
    key: 'minConfidence',
    label: 'Confianza mínima',
    step: 0.05,
    hint: 'Debajo de esto la lectura se marca como dudosa.',
  },
  {
    key: 'plateCooldown',
    label: 'Segundos antes de repetir patente',
    step: 1,
    hint: 'Evita duplicados mientras el mismo auto sigue en cuadro.',
  },
];

const CAMPOS_AVANZADOS: CameraAdvancedField[] = [
  { key: 'clusterWindow', label: 'Ventana de agrupamiento (s)', step: 0.5 },
  { key: 'clusterSettle', label: 'Quietud antes de guardar (s)', step: 0.1 },
  { key: 'bboxCloseRatio', label: 'Cercanía de recuadros', step: 0.05 },
  { key: 'fallbackInterval', label: 'Análisis forzado cada (s)', step: 30 },
  { key: 'watchdogTimeout', label: 'Segundos sin video = caída', step: 1 },
  { key: 'fps', label: 'FPS de captura', step: 1, modes: ['webcam'] },
  { key: 'width', label: 'Ancho de captura', step: 160, modes: ['webcam'] },
  { key: 'height', label: 'Alto de captura', step: 120, modes: ['webcam'] },
  { key: 'streamFps', label: 'FPS del preview', step: 1 },
  { key: 'streamQuality', label: 'Calidad del preview', step: 5 },
];

const PROBE_ERRORS: Record<string, string> = {
  falta_direccion: 'Falta la dirección IP de la cámara.',
  no_se_pudo_conectar:
    'No se pudo conectar. Revisá IP, puerto, usuario, contraseña y que la cámara esté encendida.',
  conecta_pero_no_entrega_video:
    'La cámara responde pero no entrega video. Suele ser la ruta del stream o el cifrado de imagen.',
  servicio_no_disponible:
    'El servicio de cámara no está corriendo. Reiniciá la aplicación.',
};

type ProbeState =
  | { kind: 'idle' }
  | { kind: 'probing' }
  | { kind: 'ok'; width: number; height: number; adjusted: boolean }
  | { kind: 'info'; message: string }
  | { kind: 'error'; message: string };

type ResetTarget = 'source' | 'detection' | null;

function statusCopy(status: ReturnType<typeof useCameraStatus>) {
  if (!status) {
    return {
      label: 'Sin datos',
      tone: 'muted',
      detail: 'Todavía no se pudo leer el estado del servicio.',
    };
  }
  if (status.camera === 'ok') {
    return {
      label: 'En vivo',
      tone: 'live',
      detail: status.source ?? 'La cámara está entregando video.',
    };
  }
  if (status.camera === 'initializing') {
    return {
      label: 'Conectando',
      tone: 'down',
      detail: 'El servicio está abriendo la fuente de video.',
    };
  }
  return {
    label: 'Sin señal',
    tone: 'down',
    detail: status.source ?? 'No se reciben cuadros de la cámara.',
  };
}

export function CameraSettingsPanel() {
  const { showToast } = useToast();
  const status = useCameraStatus();
  const statusInfo = statusCopy(status);
  const loadedSourceSignatureRef = useRef<string | null>(null);

  const [bridgeMissing, setBridgeMissing] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [switchingMode, setSwitchingMode] = useState(false);
  const [probe, setProbe] = useState<ProbeState>({ kind: 'idle' });

  const [useWebcam, setUseWebcam] = useState(true);
  const mode: DesktopCameraConfig['mode'] = useWebcam ? 'webcam' : 'ip';
  const [deviceIndex, setDeviceIndex] = useState(0);
  const [host, setHost] = useState('');
  const [port, setPort] = useState(String(DEFAULT_CAMERA_PORT));
  const [username, setUsername] = useState('');
  const [streamPath, setStreamPath] = useState(DEFAULT_STREAM_PATH);
  const [cameraId, setCameraId] = useState('');
  const [password, setPassword] = useState<string | null>(null);
  const [hasStoredPassword, setHasStoredPassword] = useState(false);
  const [tuning, setTuning] = useState<DesktopCameraTuning | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [resetTarget, setResetTarget] = useState<ResetTarget>(null);
  const [resetting, setResetting] = useState(false);

  const webcams = useWebcamDevices(useWebcam);
  const advancedFields = useMemo(
    () => advancedFieldsForMode(CAMPOS_AVANZADOS, mode),
    [mode],
  );
  const selectedWebcamLabel = useMemo(
    () => webcams.devices.find((device) => device.index === deviceIndex)?.label,
    [deviceIndex, webcams.devices],
  );

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
        loadedSourceSignatureRef.current = cameraSourceSignature(config);
        setLoaded(true);
      })
      .catch(() => {
        if (mounted) setLoaded(true);
      });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    const bridge = window.parkitDesktop;
    if (!bridge || typeof bridge.getCameraTuning !== 'function') return;
    let mounted = true;
    void bridge.getCameraTuning().then((current) => {
      if (mounted && current) setTuning(current);
    });
    return () => {
      mounted = false;
    };
  }, []);

  const buildInputForMode = useCallback(
    (nextMode: DesktopCameraConfig['mode']): DesktopCameraConfigInput => {
      const parsedPort = Number(port);
      const normalizedCameraId =
        nextMode === 'webcam'
          ? deriveCameraId({
              mode: nextMode,
              host,
              deviceIndex,
              webcamLabel: selectedWebcamLabel,
            })
          : cameraId.trim();

      return {
        mode: nextMode,
        deviceIndex,
        host: host.trim(),
        port:
          Number.isFinite(parsedPort) && parsedPort > 0 && parsedPort <= 65535
            ? parsedPort
            : DEFAULT_CAMERA_PORT,
        username: username.trim(),
        streamPath: streamPath.trim() || DEFAULT_STREAM_PATH,
        cameraId: normalizedCameraId,
        location: 'entrada',
        ...(password === null ? {} : { password }),
        ...(tuning ? { tuning } : {}),
      };
    },
    [
      cameraId,
      deviceIndex,
      host,
      password,
      port,
      selectedWebcamLabel,
      streamPath,
      tuning,
      username,
    ],
  );

  const buildInput = useCallback((): DesktopCameraConfigInput => {
    return buildInputForMode(mode);
  }, [buildInputForMode, mode]);

  async function applyMode(
    nextMode: DesktopCameraConfig['mode'],
  ): Promise<void> {
    if (nextMode === mode || switchingMode) return;
    const input = buildInputForMode(nextMode);
    const needsIpConfig = nextMode === 'ip' && input.host.trim().length === 0;
    setSwitchingMode(true);
    setUseWebcam(nextMode === 'webcam');
    setProbe({ kind: 'idle' });
    try {
      await saveInput(input, {
        kind: needsIpConfig ? 'info' : 'success',
        message: needsIpConfig
          ? 'Cámara IP seleccionada. Completá la dirección para conectar.'
          : nextMode === 'webcam'
            ? 'Webcam activada.'
            : 'Cámara IP activada.',
      });
    } finally {
      setSwitchingMode(false);
    }
  }

  function setTuningField(key: keyof DesktopCameraTuning, raw: string): void {
    const value = Number(raw);
    if (!Number.isFinite(value)) return;
    setTuning((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  function applyProbeSuccess(result: {
    width: number;
    height: number;
  }): boolean {
    const input = buildInput();
    const changed =
      loadedSourceSignatureRef.current !== null &&
      cameraSourceSignature(input) !== loadedSourceSignatureRef.current;
    const derivedId = deriveCameraId({
      mode,
      host,
      deviceIndex,
      webcamLabel: selectedWebcamLabel,
    });
    const nextId =
      mode === 'webcam' || shouldAutoReplaceCameraId(cameraId)
        ? derivedId
        : null;

    if (nextId && nextId !== cameraId) setCameraId(nextId);
    setTuning((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        ...(changed ? { roi: null } : {}),
        ...(mode === 'webcam'
          ? { width: result.width, height: result.height }
          : {}),
      };
    });

    return changed || (nextId !== null && nextId !== cameraId);
  }

  async function handleProbe(): Promise<void> {
    const bridge = window.parkitDesktop;
    if (!bridge) return;

    if (
      useWebcam &&
      status?.camera === 'ok' &&
      status.source === String(deviceIndex)
    ) {
      if (shouldAutoReplaceCameraId(cameraId)) {
        setCameraId(
          deriveCameraId({
            mode,
            host,
            deviceIndex,
            webcamLabel: selectedWebcamLabel,
          }),
        );
      }
      setProbe({
        kind: 'info',
        message: 'Es la cámara que está funcionando ahora mismo.',
      });
      return;
    }

    setProbe({ kind: 'probing' });
    const result = await bridge.probeCamera(buildInput());
    if (result.ok) {
      const adjusted = applyProbeSuccess(result);
      setProbe({
        kind: 'ok',
        width: result.width,
        height: result.height,
        adjusted,
      });
      return;
    }

    setProbe({
      kind: 'error',
      message: PROBE_ERRORS[result.error] ?? 'No se pudo conectar.',
    });
  }

  async function saveInput(
    input: DesktopCameraConfigInput,
    options?: { message?: string; kind?: 'success' | 'info' },
  ): Promise<void> {
    const bridge = window.parkitDesktop;
    if (!bridge) return;
    const result = await bridge.setCameraConfig(input);
    loadedSourceSignatureRef.current = cameraSourceSignature(input);
    showToast({
      message:
        options?.message ??
        (result.reconnected
          ? 'Cámara guardada y reconectada.'
          : 'Cámara guardada. Se va a usar al reiniciar la aplicación.'),
      kind: options?.kind ?? 'success',
    });
  }

  async function handleSave(): Promise<void> {
    setSaving(true);
    try {
      const input = buildInput();
      await saveInput(input);
      if (password !== null) {
        setHasStoredPassword(password.length > 0);
        setPassword(null);
      }
      setProbe({ kind: 'idle' });
    } finally {
      setSaving(false);
    }
  }

  async function handleResetSource(): Promise<void> {
    setResetting(true);
    try {
      const reset = cameraDefaultsForMode(mode, buildInput());
      await saveInput(reset);
      setDeviceIndex(reset.deviceIndex);
      setHost(reset.host);
      setPort(String(reset.port));
      setUsername(reset.username);
      setStreamPath(reset.streamPath);
      setCameraId(reset.cameraId);
      if (mode === 'ip') {
        setPassword(null);
        setHasStoredPassword(false);
      }
      setProbe({ kind: 'idle' });
      setResetTarget(null);
    } finally {
      setResetting(false);
    }
  }

  async function handleResetDetection(): Promise<void> {
    const bridge = window.parkitDesktop;
    if (!bridge || typeof bridge.resetCameraTuning !== 'function') return;
    setResetting(true);
    try {
      const defaults = await bridge.resetCameraTuning();
      if (defaults) setTuning(defaults);
      setResetTarget(null);
      showToast({
        message: defaults
          ? 'Detección restablecida.'
          : 'No se pudo contactar el servicio, pero la calibración guardada se borró.',
        kind: defaults ? 'success' : 'info',
      });
    } finally {
      setResetting(false);
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

  const canSubmit =
    (useWebcam || host.trim().length > 0) && !saving && !switchingMode;
  const confirmTitle =
    resetTarget === 'source' ? 'Restablecer cámara' : 'Restablecer detección';
  const confirmMessage =
    resetTarget === 'source'
      ? useWebcam
        ? 'La webcam vuelve a Cámara 1 y el identificador vuelve al valor predeterminado. La detección no se toca.'
        : 'Se borran IP, usuario, contraseña y se restauran puerto, ruta e identificador. La detección no se toca.'
      : 'Vuelven a fábrica la zona de detección, los ajustes básicos y los avanzados. La cámara y su contraseña no se tocan.';

  return (
    <div className="camera-settings-shell">
      <section className="camera-settings-hero">
        <div>
          <p className="camera-settings-kicker">Configuración local</p>
          <h2>Cámara de la entrada</h2>
          <p>
            Ajustá la fuente de video y calibrá qué zona se analiza para la
            detección automática de patentes.
          </p>
        </div>
        <div className={`camera-status-card ${statusInfo.tone}`}>
          <span className="camera-status-dot" />
          <div>
            <strong>{statusInfo.label}</strong>
            <span>{statusInfo.detail}</span>
          </div>
        </div>
      </section>

      {!loaded ? (
        <section className="camera-settings-card">
          <p className="muted">Cargando configuración...</p>
        </section>
      ) : (
        <>
          <section className="camera-settings-card">
            <div className="camera-settings-card-head">
              <div>
                <p className="camera-settings-kicker">Fuente de video</p>
                <h3>Cámara</h3>
              </div>
              <button
                type="button"
                className="ghost-button compact"
                onClick={() => setResetTarget('source')}
                disabled={saving || resetting}
              >
                <RotateCcw size={15} aria-hidden="true" />
                Restablecer cámara
              </button>
            </div>

            <div className="camera-mode-segments" role="tablist">
              <button
                type="button"
                className={useWebcam ? 'active' : ''}
                onClick={() => void applyMode('webcam')}
                disabled={switchingMode}
              >
                <Camera size={16} aria-hidden="true" />
                Webcam
              </button>
              <button
                type="button"
                className={!useWebcam ? 'active' : ''}
                onClick={() => void applyMode('ip')}
                disabled={switchingMode}
              >
                <Cctv size={16} aria-hidden="true" />
                Cámara IP
              </button>
            </div>

            {useWebcam ? (
              <div className="camera-source-grid camera-source-grid--webcam">
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
                      ? 'Usá “Probar conexión” si tenés más de una cámara.'
                      : 'Si está en uso, el sistema puede mostrar nombres genéricos.'}
                  </p>
                </div>
              </div>
            ) : (
              <>
                <div className="camera-source-grid">
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
                <p className="muted camera-card-note">
                  Si conecta pero no entrega video, revisá la ruta del stream y
                  desactivá el cifrado de imagen desde la app del fabricante.
                </p>
              </>
            )}
          </section>

          {tuning ? (
            <>
              <section className="camera-settings-card camera-roi-card">
                <div className="camera-settings-card-head">
                  <div>
                    <p className="camera-settings-kicker">Zona de detección</p>
                    <h3>Boca del portón</h3>
                  </div>
                </div>
                <p className="muted camera-card-note">
                  Todo lo que quede fuera de la zona no se analiza.
                </p>
                <RoiEditor
                  value={tuning.roi}
                  onChange={(roi) =>
                    setTuning((prev) => (prev ? { ...prev, roi } : prev))
                  }
                />
              </section>

              <section className="camera-settings-card">
                <div className="camera-settings-card-head">
                  <div>
                    <p className="camera-settings-kicker">Detección</p>
                    <h3>Ajustes principales</h3>
                  </div>
                  <button
                    type="button"
                    className="ghost-button compact"
                    onClick={() => setResetTarget('detection')}
                    disabled={resetting}
                  >
                    <RotateCcw size={15} aria-hidden="true" />
                    Restablecer ajustes
                  </button>
                </div>
                <div className="camera-settings-grid">
                  {CAMPOS_BASICOS.map((campo) => (
                    <div className="printer-panel-field" key={campo.key}>
                      <label className="form-label" htmlFor={`t-${campo.key}`}>
                        {campo.label}
                      </label>
                      <input
                        id={`t-${campo.key}`}
                        type="number"
                        step={campo.step}
                        value={String(tuning[campo.key] ?? '')}
                        onChange={(event) =>
                          setTuningField(campo.key, event.target.value)
                        }
                      />
                      <p className="muted printer-panel-hint">{campo.hint}</p>
                    </div>
                  ))}
                </div>

                <div className="camera-tuning-actions">
                  <button
                    type="button"
                    className="ghost-button compact"
                    onClick={() => setShowAdvanced((open) => !open)}
                  >
                    <SlidersHorizontal size={15} aria-hidden="true" />
                    {showAdvanced ? 'Ocultar' : 'Mostrar'} ajustes avanzados
                  </button>
                </div>

                {showAdvanced ? (
                  <div className="camera-settings-grid camera-advanced-grid">
                    {advancedFields.map((campo) => (
                      <div className="printer-panel-field" key={campo.key}>
                        <label
                          className="form-label"
                          htmlFor={`t-${campo.key}`}
                        >
                          {campo.label}
                        </label>
                        <input
                          id={`t-${campo.key}`}
                          type="number"
                          step={campo.step}
                          value={String(tuning[campo.key] ?? '')}
                          onChange={(event) =>
                            setTuningField(campo.key, event.target.value)
                          }
                        />
                      </div>
                    ))}
                  </div>
                ) : null}
              </section>
            </>
          ) : null}

          <section className="camera-settings-actions">
            <div>
              {switchingMode ? (
                <p className="csd-note">Aplicando modo...</p>
              ) : null}
              {probe.kind === 'ok' ? (
                <p className="csd-note">
                  Conecta correctamente · {probe.width}×{probe.height}
                  {probe.adjusted ? ' · ajustes preparados' : ''}
                </p>
              ) : null}
              {probe.kind === 'info' ? (
                <p className="csd-note">{probe.message}</p>
              ) : null}
              {probe.kind === 'error' ? (
                <p className="csd-note csd-note--warning">{probe.message}</p>
              ) : null}
            </div>
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
          </section>
        </>
      )}

      <ConfirmDialog
        open={resetTarget !== null}
        title={confirmTitle}
        message={confirmMessage}
        confirmLabel="Restablecer"
        variant="warning"
        isPending={resetting}
        onCancel={() => setResetTarget(null)}
        onConfirm={() =>
          resetTarget === 'source'
            ? void handleResetSource()
            : void handleResetDetection()
        }
      />
    </div>
  );
}
