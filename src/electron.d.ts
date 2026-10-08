export {};

declare global {
  /** Electron's PrinterInfo, trimmed to what the UI needs. */
  interface DesktopPrinter {
    name: string;
    displayName: string;
    isDefault: boolean;
  }

  type DesktopPrintResult =
    | { ok: true }
    | {
        ok: false;
        reason:
          | 'no-window'
          | 'no-printer'
          | 'printer-not-found'
          | 'print-failed'
          | 'timeout';
        detail?: string;
      };

  type DesktopSaveFileResult =
    | { ok: true; path: string }
    | { ok: false; reason: 'canceled' | 'write-failed'; detail?: string };

  type DesktopRenderPdfResult =
    | { ok: true; data: Uint8Array }
    | {
        ok: false;
        reason: 'invalid-payload' | 'render-failed';
        detail?: string;
      };

  /** De dónde sale el video de este equipo. */
  type DesktopCameraMode = 'webcam' | 'ip';

  /** Config de la cámara de ESTE equipo. Nunca incluye la contraseña. */
  interface DesktopCameraConfig {
    mode: DesktopCameraMode;
    /** Índice con el que OpenCV abre la webcam. Es una posición, no un id. */
    deviceIndex: number;
    host: string;
    port: number;
    username: string;
    /** Ruta del stream tal como la publica la cámara, ej. `/h264_stream`. */
    streamPath: string;
    /** Identificador estable que viaja en cada detección. */
    cameraId: string;
    location: 'entrada' | 'salida';
  }

  /** Lo que devuelve `getCameraConfig`: la config sin la clave, más si hay una. */
  type DesktopCameraConfigRead = DesktopCameraConfig & { hasPassword: boolean };

  /**
   * Lo que se manda al guardar o probar. `password` ausente significa "dejá la
   * que ya está guardada": el panel solo la envía si el usuario la reescribe.
   */
  type DesktopCameraConfigInput = DesktopCameraConfig & {
    password?: string;
    /** Ajustes de detección. Ausente = no tocar los guardados. */
    tuning?: DesktopCameraTuning;
  };

  /**
   * Ajustes que se calibran en cada instalación.
   *
   * Los defaults viven en el servicio Python, no acá: es su única fuente de
   * verdad y el panel muestra siempre los valores vigentes que él reporta.
   */
  interface DesktopCameraTuning {
    motionThreshold: number;
    motionCooldown: number;
    minConfidence: number;
    plateCooldown: number;
    fallbackInterval: number;
    clusterWindow: number;
    clusterSettle: number;
    /** Letras que pueden diferir y seguir siendo la misma patente. */
    plateMergeDistance: number;
    /** Cuánto puede moverse la patente entre dos lecturas, de 0 a 1. */
    moveMaxRatio: number;
    fps: number;
    width: number;
    height: number;
    watchdogTimeout: number;
    streamFps: number;
    streamQuality: number;
    /** `[x1, y1, x2, y2]` en píxeles del frame, o null = cuadro completo. */
    roi: [number, number, number, number] | null;
  }

  type DesktopCameraProbeResult =
    | { ok: true; width: number; height: number }
    | {
        ok: false;
        error:
          | 'falta_direccion'
          | 'no_se_pudo_conectar'
          | 'conecta_pero_no_entrega_video'
          | 'servicio_no_disponible';
      };

  type DesktopCameraServiceState =
    | 'managed'
    | 'adopted'
    | 'unavailable'
    | 'running'
    | 'stopped'
    | 'failed';

  interface DesktopCameraServiceStatus {
    name: string;
    state: DesktopCameraServiceState;
    healthy: boolean;
    pid: number | null;
    lastError?: string;
  }

  interface Window {
    parkitDesktop?: {
      platform: string;
      onServicesFailed: (callback: (names: string[]) => void) => void;
      getFailedServices: () => Promise<string[]>;
      onServiceCrashed: (callback: (name: string) => void) => () => void;
      onServiceRecovered: (callback: (name: string) => void) => () => void;
      startDesktopService: (
        name: 'lpr-service' | 'camera-service',
      ) => Promise<DesktopCameraServiceStatus>;
      restartDesktopService: (
        name: 'lpr-service' | 'camera-service',
      ) => Promise<DesktopCameraServiceStatus>;
      openExternal: (url: string) => Promise<void>;
      copyText: (value: string) => Promise<{ ok: boolean }>;
      onOAuthCallback: (callback: (url: string) => void) => () => void;
      listPrinters: () => Promise<DesktopPrinter[]>;
      printTicket: (payload: {
        html: string;
        deviceName: string | null;
        /** Papel alimentado después de la última línea, para la guillotina. */
        tailFeedMm: number;
        /** Ancho físico del papel que se manda al driver. */
        mediaWidthMm: number | null;
        /** Ancho útil del contenido HTML. */
        bodyWidthMm: number | null;
        /** Abre el diálogo nativo para diagnosticar qué tamaño toma el driver. */
        debugDialog?: boolean;
      }) => Promise<DesktopPrintResult>;
      renderPdf: (payload: { html: string }) => Promise<DesktopRenderPdfResult>;
      saveFile: (payload: {
        defaultName: string;
        data: Uint8Array;
      }) => Promise<DesktopSaveFileResult>;
      showSavedFileInFolder: (filePath: string) => Promise<{ ok: boolean }>;
      getCameraServiceStatus: () => Promise<DesktopCameraServiceStatus>;
      startCameraService: () => Promise<DesktopCameraServiceStatus>;
      restartCameraService: () => Promise<DesktopCameraServiceStatus>;
      getCameraConfig: () => Promise<DesktopCameraConfigRead>;
      probeCamera: (
        config: DesktopCameraConfigInput,
      ) => Promise<DesktopCameraProbeResult>;
      setCameraConfig: (
        config: DesktopCameraConfigInput,
      ) => Promise<{ ok: true; reconnected: boolean }>;
      getCameraTuning: () => Promise<DesktopCameraTuning | null>;
      resetCameraTuning: () => Promise<DesktopCameraTuning | null>;
    };
  }
}
