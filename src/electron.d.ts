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
  type DesktopCameraConfigInput = DesktopCameraConfig & { password?: string };

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

  interface Window {
    parkitDesktop?: {
      platform: string;
      onServicesFailed: (callback: (names: string[]) => void) => void;
      getFailedServices: () => Promise<string[]>;
      onServiceCrashed: (callback: (name: string) => void) => () => void;
      openExternal: (url: string) => Promise<void>;
      onOAuthCallback: (callback: (url: string) => void) => () => void;
      listPrinters: () => Promise<DesktopPrinter[]>;
      printTicket: (payload: {
        html: string;
        deviceName: string | null;
        /** Papel alimentado después de la última línea, para la guillotina. */
        tailFeedMm: number;
        pageWidthMm: number | null;
      }) => Promise<DesktopPrintResult>;
      getCameraConfig: () => Promise<DesktopCameraConfigRead>;
      probeCamera: (
        config: DesktopCameraConfigInput,
      ) => Promise<DesktopCameraProbeResult>;
      setCameraConfig: (
        config: DesktopCameraConfigInput,
      ) => Promise<{ ok: true; reconnected: boolean }>;
    };
  }
}
