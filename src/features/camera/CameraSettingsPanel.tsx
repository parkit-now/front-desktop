import {
  Camera,
  Cctv,
  Cog,
  FlaskConical,
  Info,
  Play,
  PlugZap,
  RefreshCcw,
  RotateCcw,
  Save,
  SlidersHorizontal,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useToast } from '../../lib/notifications/ToastProvider';
import {
  fetchEntityProfileSettings,
  updateEntityDesktopCameraConfig,
  type DesktopCameraConfigPayload,
} from '../../lib/api/entities';
import { ConfirmDialog } from '../../lib/ui/ConfirmDialog';
import { AppSelect } from '../../lib/ui/AppSelect';
import { useWebcamDevices } from './useWebcamDevices';
import { useCameraStatus } from './useCameraStatus';
import { RoiEditor } from './RoiEditor';
import { useCameraTestingMode, writeCameraTestingMode } from './testingMode';
import {
  DEFAULT_CAMERA_PORT,
  DEFAULT_STREAM_PATH,
  advancedFieldsForMode,
  cameraDefaultsForMode,
  cameraSourceSignature,
  deriveCameraId,
  shouldAutoReplaceCameraId,
  validateCameraTuning,
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
    hint: 'Más bajo = más intentos por auto, y la tarjeta aparece antes. También fija el mínimo de "Quietud antes de guardar".',
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
    hint: 'Red de seguridad. Los duplicados los corta antes el agrupamiento, y un auto ya registrado no vuelve a generar tarjeta.',
  },
];

const CAMPOS_AVANZADOS: CameraAdvancedField[] = [
  {
    key: 'clusterWindow',
    label: 'Ventana de agrupamiento (s)',
    step: 0.5,
    hint: 'Tiempo máximo durante el que se juntan lecturas parecidas del mismo vehículo antes de guardar una tarjeta.',
  },
  {
    key: 'clusterSettle',
    label: 'Quietud antes de guardar (s)',
    step: 0.1,
    hint: 'Tiempo sin nuevas lecturas antes de cerrar el grupo y crear la tarjeta. Debe superar los segundos entre análisis.',
  },
  {
    key: 'plateMergeDistance',
    label: 'Letras distintas que se toleran',
    step: 1,
    hint: 'Cantidad de caracteres que pueden diferir entre dos lecturas para tratarlas como el mismo vehículo.',
  },
  {
    key: 'moveMaxRatio',
    label: 'Movimiento máximo entre lecturas',
    step: 0.05,
    hint: 'Distancia máxima que puede moverse la patente entre lecturas para seguir agrupándolas.',
  },
  {
    key: 'fallbackInterval',
    label: 'Análisis forzado cada (s)',
    step: 30,
    hint: 'Cada cuánto se analiza un cuadro aunque no se detecte movimiento. Sirve como respaldo.',
  },
  {
    key: 'watchdogTimeout',
    label: 'Segundos sin video = caída',
    step: 1,
    hint: 'Tiempo sin recibir cuadros antes de considerar caída la cámara e intentar recuperar.',
  },
  {
    key: 'fps',
    label: 'FPS de captura',
    step: 1,
    modes: ['webcam'],
    hint: 'Cuadros por segundo que se le piden a la webcam para captura y detección.',
  },
  {
    key: 'width',
    label: 'Ancho de captura',
    step: 160,
    modes: ['webcam'],
    hint: 'Ancho en píxeles solicitado a la webcam. Más resolución ayuda, pero consume más CPU.',
  },
  {
    key: 'height',
    label: 'Alto de captura',
    step: 120,
    modes: ['webcam'],
    hint: 'Alto en píxeles solicitado a la webcam. Más resolución ayuda, pero consume más CPU.',
  },
  {
    key: 'streamFps',
    label: 'FPS del preview',
    step: 1,
    hint: 'Cuadros por segundo del video de vista previa. No puede superar los FPS de captura.',
  },
  {
    key: 'streamQuality',
    label: 'Calidad del preview',
    step: 5,
    hint: 'Calidad JPEG del video de vista previa. Más alto se ve mejor y pesa más.',
  },
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
type ServiceAction = 'start' | 'restart';

type Props = {
  tenantId?: string | null;
  accessToken?: string | null;
};

function serviceStatusCopy(status: DesktopCameraServiceStatus | null) {
  if (!status) {
    return {
      label: 'Revisando servicio',
      detail: 'Consultando el supervisor local.',
      canStart: false,
      canRestart: false,
    };
  }

  if (status.state === 'adopted') {
    return {
      label: 'Servicio externo',
      detail: 'Fue iniciado fuera de Parkit; no se reinicia desde acá.',
      canStart: false,
      canRestart: false,
    };
  }

  if (status.state === 'unavailable') {
    return {
      label: 'Servicio no administrado',
      detail: 'No hay binario local disponible para iniciar desde la app.',
      canStart: false,
      canRestart: false,
    };
  }

  if (status.healthy) {
    return {
      label: 'Servicio activo',
      detail: status.pid ? `Proceso ${status.pid}` : 'Responde correctamente.',
      canStart: false,
      canRestart: true,
    };
  }

  if (status.state === 'managed') {
    return {
      label: 'Iniciando servicio',
      detail: 'El proceso está levantando o esperando healthcheck.',
      canStart: false,
      canRestart: true,
    };
  }

  if (status.state === 'failed' && status.pid) {
    return {
      label: 'Servicio sin respuesta',
      detail:
        status.lastError === 'health_timeout'
          ? 'Arrancó pero no respondió a tiempo.'
          : 'El proceso quedó vivo pero no está saludable.',
      canStart: false,
      canRestart: true,
    };
  }

  return {
    label: status.state === 'failed' ? 'Servicio detenido' : 'Servicio cerrado',
    detail:
      status.lastError === 'health_timeout'
        ? 'Arrancó pero no respondió a tiempo.'
        : 'Podés iniciarlo sin reiniciar la app.',
    canStart: true,
    canRestart: false,
  };
}

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

function cameraPayload(
  input: DesktopCameraConfigInput,
): DesktopCameraConfigPayload {
  return {
    mode: input.mode,
    deviceIndex: input.deviceIndex,
    host: input.host,
    port: input.port,
    username: input.username,
    streamPath: input.streamPath,
    cameraId: input.cameraId,
    location: input.location,
    tuning: (input.tuning as Record<string, unknown> | undefined) ?? null,
  };
}

function remoteCameraInput(
  config: DesktopCameraConfigPayload,
): DesktopCameraConfigInput {
  return {
    mode: config.mode,
    deviceIndex: config.deviceIndex,
    host: config.host,
    port: config.port,
    username: config.username,
    streamPath: config.streamPath,
    cameraId: config.cameraId,
    location: config.location,
    ...(config.tuning
      ? { tuning: config.tuning as unknown as DesktopCameraTuning }
      : {}),
  };
}

function TuningFieldLabel({
  htmlFor,
  label,
  hint,
}: {
  htmlFor: string;
  label: string;
  hint: string;
}) {
  return (
    <label className="form-label camera-field-label" htmlFor={htmlFor}>
      <span>{label}</span>
      <span
        className="camera-field-info"
        tabIndex={0}
        aria-label={hint}
        data-tooltip={hint}
      >
        <Info size={14} aria-hidden="true" />
      </span>
    </label>
  );
}

export function CameraSettingsPanel({
  tenantId = null,
  accessToken = null,
}: Props) {
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
  const testingMode = useCameraTestingMode();
  const [resetTarget, setResetTarget] = useState<ResetTarget>(null);
  const [resetting, setResetting] = useState(false);
  const [serviceStatus, setServiceStatus] =
    useState<DesktopCameraServiceStatus | null>(null);
  const [serviceAction, setServiceAction] = useState<ServiceAction | null>(
    null,
  );
  const [serviceError, setServiceError] = useState<string | null>(null);

  const webcams = useWebcamDevices(useWebcam);
  const advancedFields = useMemo(
    () => advancedFieldsForMode(CAMPOS_AVANZADOS, mode),
    [mode],
  );
  const tuningIssues = useMemo(
    () => (tuning ? validateCameraTuning(tuning) : []),
    [tuning],
  );
  // Advierte, no bloquea. El servicio clampea los valores incoherentes por su
  // cuenta y `saveInput` relee lo que quedó aplicado, así que deshabilitar el
  // botón sería impedir algo que se resuelve solo — y un botón gris no explica
  // nada, ni lo anuncian los lectores de pantalla (ver AGENTS.md).
  const tuningIssueMessage = tuningIssues[0]?.message ?? null;
  const selectedWebcamLabel = useMemo(
    () => webcams.devices.find((device) => device.index === deviceIndex)?.label,
    [deviceIndex, webcams.devices],
  );
  const serviceInfo = serviceStatusCopy(serviceStatus);
  const serviceButtonLabel = serviceAction
    ? serviceAction === 'start'
      ? 'Iniciando...'
      : 'Reiniciando...'
    : serviceInfo.canStart
      ? 'Abrir servicio'
      : 'Reiniciar servicio';
  const serviceButtonDisabled =
    Boolean(serviceAction) ||
    (!serviceInfo.canStart && !serviceInfo.canRestart);
  const cameraDownWithService =
    status?.camera === 'down' && serviceStatus?.healthy === true;

  const refreshServiceStatus = useCallback(async () => {
    const bridge = window.parkitDesktop;
    if (!bridge || typeof bridge.getCameraServiceStatus !== 'function') return;
    const next = await bridge.getCameraServiceStatus();
    setServiceStatus(next);
  }, []);

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
    if (!loaded || !tenantId || !accessToken) return;
    const bridge = window.parkitDesktop;
    if (!bridge || typeof bridge.setCameraConfig !== 'function') return;

    let mounted = true;
    void fetchEntityProfileSettings(tenantId, accessToken)
      .then(async (settings) => {
        if (!mounted) return;
        if (!settings.desktopCameraConfig) {
          const initialInput = buildInput();
          await updateEntityDesktopCameraConfig(
            tenantId,
            accessToken,
            cameraPayload(initialInput),
          ).catch(() => undefined);
          return;
        }

        const input = remoteCameraInput(settings.desktopCameraConfig);
        await bridge.setCameraConfig(input);
        if (!mounted) return;
        setUseWebcam(input.mode === 'webcam');
        setDeviceIndex(input.deviceIndex);
        setHost(input.host);
        setPort(String(input.port));
        setUsername(input.username);
        setStreamPath(input.streamPath);
        setCameraId(input.cameraId);
        if (input.tuning) setTuning(input.tuning);
        loadedSourceSignatureRef.current = cameraSourceSignature(input);
      })
      .catch(() => undefined);

    return () => {
      mounted = false;
    };
  }, [accessToken, loaded, tenantId]);

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

  useEffect(() => {
    void refreshServiceStatus();
    const id = setInterval(() => void refreshServiceStatus(), 10_000);
    return () => clearInterval(id);
  }, [refreshServiceStatus]);

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
    setProbe({ kind: 'idle' });
    try {
      // El switch se mueve DESPUÉS de que el guardado haya funcionado.
      //
      // Al revés —que era como estaba— si el guardado no llegaba a aplicarse,
      // el switch quedaba mostrando la cámara nueva mientras el servicio
      // seguía con la vieja. No hay peor estado que ese: la pantalla dice una
      // cosa, el video muestra otra, y no hay nada que lo explique.
      const saved = await saveInput(input, {
        kind: needsIpConfig ? 'info' : 'success',
        message: needsIpConfig
          ? 'Cámara IP seleccionada. Completá la dirección para conectar.'
          : nextMode === 'webcam'
            ? 'Webcam activada.'
            : 'Cámara IP activada.',
      });
      if (saved) setUseWebcam(nextMode === 'webcam');
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

  async function handleServiceAction(): Promise<void> {
    const bridge = window.parkitDesktop;
    if (!bridge) return;
    const action: ServiceAction = serviceInfo.canStart ? 'start' : 'restart';
    const run =
      action === 'start'
        ? bridge.startCameraService
        : bridge.restartCameraService;
    if (typeof run !== 'function') return;

    setServiceAction(action);
    setServiceError(null);
    try {
      const next = await run();
      setServiceStatus(next);
      await refreshServiceStatus();
      if (next.healthy) {
        showToast({
          message:
            action === 'start'
              ? 'Servicio de cámara iniciado.'
              : 'Servicio de cámara reiniciado.',
          kind: 'success',
        });
      } else {
        setServiceError('El servicio no respondió al healthcheck.');
        showToast({
          message: 'No se pudo dejar activo el servicio de cámara.',
          kind: 'error',
        });
      }
    } catch {
      setServiceError('No se pudo contactar el supervisor local.');
      showToast({
        message: 'No se pudo controlar el servicio de cámara.',
        kind: 'error',
      });
    } finally {
      setServiceAction(null);
    }
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

  /**
   * Guarda la configuración y devuelve si realmente se aplicó.
   *
   * NO valida la calibración acá, y es a propósito. Antes cortaba si
   * `validateCameraTuning` encontraba algo, y como TODAS las rutas mandan el
   * `tuning` adjunto —cambiar de webcam a IP, restablecer la cámara— un ajuste
   * de detección a medio escribir bloqueaba cosas que no tienen nada que ver,
   * con un cartel hablando de agrupamiento.
   *
   * Además no hacía falta: el servicio clampea los valores incoherentes por su
   * cuenta y acá abajo se relee lo que quedó aplicado. Bloquear era impedirle
   * al operador algo que el servicio resuelve solo.
   *
   * La advertencia sigue existiendo, pero como eso: una advertencia en el
   * formulario, al lado del campo.
   */
  async function saveInput(
    input: DesktopCameraConfigInput,
    options?: { message?: string; kind?: 'success' | 'info' },
  ): Promise<boolean> {
    const bridge = window.parkitDesktop;
    if (!bridge) return false;
    const result = await bridge.setCameraConfig(input);
    if (tenantId && accessToken) {
      void updateEntityDesktopCameraConfig(
        tenantId,
        accessToken,
        cameraPayload(input),
      ).catch(() => undefined);
    }
    loadedSourceSignatureRef.current = cameraSourceSignature(input);

    // Releer lo que el servicio realmente aplicó, que no siempre es lo que se
    // le mandó: hay ajustes que se clampean entre sí. "Quietud antes de
    // guardar" no puede ser menor que "Segundos entre análisis", porque si no
    // el agrupamiento se cierra antes de que llegue la segunda lectura y no
    // agrupa nunca. Sin esta relectura el panel mostraría el valor pedido
    // mientras el servicio corre con otro, que es imposible de diagnosticar.
    const applied = await bridge.getCameraTuning().catch(() => null);
    if (applied) setTuning(applied);

    showToast({
      message:
        options?.message ??
        (result.reconnected
          ? 'Cámara guardada y reconectada.'
          : 'Cámara guardada. Se va a usar al reiniciar la aplicación.'),
      kind: options?.kind ?? 'success',
    });
    return true;
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
      if (tenantId && accessToken) {
        void updateEntityDesktopCameraConfig(
          tenantId,
          accessToken,
          cameraPayload({
            ...buildInput(),
            tuning: defaults ?? ({} as unknown as DesktopCameraTuning),
          }),
        ).catch(() => undefined);
      }
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
        <div className="camera-settings-hero-copy">
          <p className="camera-settings-kicker">Configuración local</p>
          <h2>Cámara de la entrada</h2>
          <p>
            Ajustá la fuente de video y calibrá la detección automática de
            patentes.
          </p>
        </div>
        <div className="camera-hero-status">
          <div className={`camera-status-card ${statusInfo.tone}`}>
            <span className="camera-status-dot" />
            <div>
              <span className="camera-settings-kicker">Video</span>
              <strong>{statusInfo.label}</strong>
              <span>{statusInfo.detail}</span>
            </div>
          </div>
          <div className="camera-service-card">
            <span className="camera-service-icon" aria-hidden="true">
              <Cog size={17} />
            </span>
            <div>
              <span className="camera-settings-kicker">Servicio local</span>
              <strong>{serviceInfo.label}</strong>
              <span>{serviceError ?? serviceInfo.detail}</span>
            </div>
            <button
              type="button"
              className={
                serviceInfo.canStart
                  ? 'primary-button compact'
                  : 'ghost-button compact'
              }
              onClick={() => void handleServiceAction()}
              disabled={serviceButtonDisabled}
            >
              {serviceInfo.canStart ? (
                <Play size={15} aria-hidden="true" />
              ) : (
                <RefreshCcw size={15} aria-hidden="true" />
              )}
              {serviceButtonLabel}
            </button>
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
                      <TuningFieldLabel
                        htmlFor={`t-${campo.key}`}
                        label={campo.label}
                        hint={campo.hint}
                      />
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
                        <TuningFieldLabel
                          htmlFor={`t-${campo.key}`}
                          label={campo.label}
                          hint={campo.hint}
                        />
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

          <section className="camera-settings-card">
            <div className="camera-settings-card-head">
              <div>
                <p className="camera-settings-kicker">Pruebas</p>
                <h3>Modo prueba</h3>
              </div>
            </div>
            <label
              className="camera-testing-toggle"
              htmlFor="camera-testing-mode"
            >
              <input
                id="camera-testing-mode"
                type="checkbox"
                checked={testingMode}
                onChange={(event) =>
                  writeCameraTestingMode(event.target.checked)
                }
              />
              <span>Mostrar todas las patentes detectadas</span>
            </label>
            <p className="muted camera-card-note">
              Para probar la cámara pasando siempre el mismo auto. Con el modo
              activo aparece en Operativo una tarjeta por cada detección, aunque
              el auto ya esté adentro, haya salido hace poco o ya tenga otra
              tarjeta abierta. Se aplica al instante y solo en esta computadora.
            </p>
            {testingMode ? (
              <p className="csd-note csd-note--warning">
                <FlaskConical size={15} aria-hidden="true" />
                Apagalo al terminar: en uso normal llena Operativo de tarjetas
                repetidas.
              </p>
            ) : null}
          </section>

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
              {tuningIssueMessage ? (
                <p className="csd-note csd-note--warning">
                  {tuningIssueMessage} Si lo guardás así, el servicio lo va a
                  ajustar solo y el panel va a mostrar el valor que quedó.
                </p>
              ) : null}
              {cameraDownWithService ? (
                <p className="csd-note csd-note--warning">
                  El servicio está activo, pero no recibe video. Revisá usuario,
                  contraseña, IP o ruta del stream.
                </p>
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
