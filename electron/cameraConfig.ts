/**
 * Configuración de la cámara de este equipo.
 *
 * POR QUÉ VIVE EN UN ARCHIVO Y NO EN localStorage COMO LA IMPRESORA
 *
 * `src/lib/print/printerSettings.ts` guarda su config en localStorage porque el
 * único que la necesita es el renderer. Acá no alcanza: el valor lo consume el
 * proceso **main** para armar el `env` con el que lanza `camera-service`, y main
 * no puede leer el localStorage del renderer. Además el servicio arranca antes
 * del login, así que la config tiene que estar disponible sin que haya sesión.
 *
 * QUÉ ES DE ESTE EQUIPO Y QUÉ ES DEL ESTACIONAMIENTO
 *
 * La URL y la contraseña son de este equipo: una IP `192.168.x.x` solo tiene
 * sentido dentro de la red de esa playa, y la clave de la cámara no tiene por
 * qué viajar a la nube. Lo que sí pertenece al estacionamiento —qué cámara es la
 * de la entrada— vive en el backend (`tenants.entry_camera_id`) y baja por sync.
 */

import { app, safeStorage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

/** De dónde sale el video. */
export type CameraMode = 'webcam' | 'ip';

export interface CameraConfig {
  mode: CameraMode;
  /**
   * Índice con el que OpenCV abre la webcam. Es la POSICIÓN del dispositivo,
   * no un identificador: ver el comentario de `enumerateWebcams` en el panel.
   */
  deviceIndex: number;
  /** Host o IP de la cámara. Vacío = no configurada. */
  host: string;
  port: number;
  username: string;
  /** Ruta del stream, tal como la publica la cámara (ej. `/h264_stream`). */
  streamPath: string;
  /** Identificador estable que viaja en cada detección. */
  cameraId: string;
  location: 'entrada' | 'salida';
}

/**
 * Ajustes de detección que se calibran en el lugar.
 *
 * Se guardan como PARCIAL y sin defaults propios: los defaults viven en el
 * servicio Python y son su única fuente de verdad. Duplicarlos acá garantizaría
 * que en algún momento los dos lados digan cosas distintas y nadie sepa cuál
 * gana. El panel lee los valores vigentes con `GET /config` y acá solo queda lo
 * que alguien cambió a mano, para poder reaplicarlo al reiniciar.
 */
export type CameraTuning = Record<string, number | number[] | null>;

/** Lo que se persiste: igual que `CameraConfig` más la contraseña cifrada. */
interface StoredCameraConfig extends CameraConfig {
  tuning: CameraTuning;
  /** base64 del blob de `safeStorage`, o texto plano si no hay cifrado. */
  password: string;
  /** `false` cuando el SO no ofreció cifrado y hubo que guardar en claro. */
  passwordEncrypted: boolean;
}

const FILE_NAME = 'camera.json';
const DEFAULT_PORT = 554;
const DEFAULT_STREAM_PATH = '/h264_stream';

export const DEFAULT_CAMERA_ID = 'cam-01';

function configPath(): string {
  return path.join(app.getPath('userData'), FILE_NAME);
}

function defaults(): StoredCameraConfig {
  return {
    // Un equipo nuevo arranca exactamente como venía funcionando: webcam 0.
    mode: 'webcam',
    deviceIndex: 0,
    host: '',
    port: DEFAULT_PORT,
    username: '',
    password: '',
    passwordEncrypted: false,
    streamPath: DEFAULT_STREAM_PATH,
    cameraId: DEFAULT_CAMERA_ID,
    location: 'entrada',
    tuning: {},
  };
}

function asString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

/** Nunca tira: un archivo corrupto degrada a "sin configurar", no rompe el arranque. */
function readStored(): StoredCameraConfig {
  try {
    const raw = fs.readFileSync(configPath(), 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return defaults();
    const value = parsed as Record<string, unknown>;
    const base = defaults();
    const port = Number(value.port);
    const deviceIndex = Number(value.deviceIndex);
    const host = asString(value.host, base.host);
    return {
      // Un `camera.json` escrito antes de que existiera el switch no tiene
      // `mode`. Se deduce del host: si configuró una cámara IP, estaba usándola.
      mode:
        value.mode === 'ip' || value.mode === 'webcam'
          ? value.mode
          : host.trim()
            ? 'ip'
            : 'webcam',
      deviceIndex:
        Number.isInteger(deviceIndex) && deviceIndex >= 0
          ? deviceIndex
          : base.deviceIndex,
      host,
      port:
        Number.isFinite(port) && port > 0 && port <= 65535 ? port : base.port,
      username: asString(value.username, base.username),
      password: asString(value.password, base.password),
      passwordEncrypted: value.passwordEncrypted === true,
      streamPath: asString(value.streamPath, base.streamPath),
      cameraId: asString(value.cameraId, base.cameraId) || base.cameraId,
      location: value.location === 'salida' ? 'salida' : 'entrada',
      tuning:
        typeof value.tuning === 'object' && value.tuning !== null
          ? (value.tuning as CameraTuning)
          : base.tuning,
    };
  } catch {
    return defaults();
  }
}

function decryptPassword(stored: StoredCameraConfig): string {
  if (!stored.password) return '';
  if (!stored.passwordEncrypted) return stored.password;
  try {
    return safeStorage.decryptString(Buffer.from(stored.password, 'base64'));
  } catch {
    // En Windows el blob de DPAPI está atado a la cuenta de usuario: copiar el
    // archivo a otra PC (o a otro usuario) da un blob indescifrable. No es un
    // error que se pueda recuperar solo — el panel tiene que pedir la clave de
    // nuevo, y para eso devolvemos vacío en vez de propagar la excepción.
    console.warn('[camera] no se pudo descifrar la contraseña guardada');
    return '';
  }
}

/**
 * Olvida los ajustes calibrados en este equipo.
 *
 * Imprescindible al restablecer: si solo se reseteara el servicio, al próximo
 * arranque `pushCameraTuning` volvería a aplicarle los valores viejos y el botón
 * parecería no haber hecho nada.
 */
export function clearCameraTuning(): void {
  const stored = readStored();
  writeCameraConfig({ ...stored, tuning: {} });
}

/** Los ajustes de detección guardados, para reaplicarlos al arrancar. */
export function readCameraTuning(): CameraTuning {
  return readStored().tuning;
}

/** Config sin la contraseña: es lo único que puede cruzar al renderer. */
export function readCameraConfig(): CameraConfig & { hasPassword: boolean } {
  const stored = readStored();
  const { password, passwordEncrypted, ...rest } = stored;
  void passwordEncrypted;
  return { ...rest, hasPassword: password.length > 0 };
}

export interface CameraConfigInput extends CameraConfig {
  /** `undefined` = dejar la que ya está guardada (el panel no la re-manda). */
  password?: string;
  /** `undefined` = no tocar los ajustes guardados. */
  tuning?: CameraTuning;
}

export function writeCameraConfig(input: CameraConfigInput): void {
  const previous = readStored();
  const plainPassword =
    input.password === undefined ? decryptPassword(previous) : input.password;

  let password = plainPassword;
  let passwordEncrypted = false;
  if (plainPassword && safeStorage.isEncryptionAvailable()) {
    password = safeStorage.encryptString(plainPassword).toString('base64');
    passwordEncrypted = true;
  } else if (plainPassword) {
    // Linux sin keyring (libsecret/kwallet) es el caso típico. Se guarda igual
    // porque sin contraseña la cámara no abre, pero queda dicho en el log.
    console.warn(
      '[camera] safeStorage no disponible: la contraseña se guarda sin cifrar',
    );
  }

  const next: StoredCameraConfig = {
    mode: input.mode,
    deviceIndex:
      Number.isInteger(input.deviceIndex) && input.deviceIndex >= 0
        ? input.deviceIndex
        : 0,
    host: input.host.trim(),
    port: input.port,
    username: input.username.trim(),
    password,
    passwordEncrypted,
    streamPath: input.streamPath.trim() || DEFAULT_STREAM_PATH,
    cameraId: input.cameraId.trim() || DEFAULT_CAMERA_ID,
    location: input.location,
    tuning: input.tuning ?? previous.tuning,
  };

  fs.writeFileSync(configPath(), JSON.stringify(next, null, 2), {
    encoding: 'utf8',
    mode: 0o600, // solo el dueño: adentro hay una credencial
  });
}

/**
 * Arma la URL RTSP completa, con la contraseña en claro.
 *
 * El valor que devuelve NO puede ir a un log ni cruzar al renderer: es la única
 * función del módulo que expone la credencial, y existe para dos consumidores,
 * los dos en el proceso main — el `env` del spawn y el probe.
 */
export function buildRtspUrl(
  config: CameraConfig,
  password: string,
): string | null {
  if (!config.host.trim()) return null;
  const auth = config.username
    ? `${encodeURIComponent(config.username)}:${encodeURIComponent(password)}@`
    : '';
  const suffix = config.streamPath.startsWith('/')
    ? config.streamPath
    : `/${config.streamPath}`;
  return `rtsp://${auth}${config.host.trim()}:${config.port}${suffix}`;
}

/**
 * La fuente que le corresponde a una config: índice de webcam o URL RTSP.
 *
 * `null` significa "no hay nada configurado", y el llamador decide qué hacer.
 * En modo webcam nunca es null: el índice 0 siempre es una respuesta válida.
 */
function sourceFor(config: CameraConfig, password: string): string | null {
  if (config.mode === 'webcam') return String(config.deviceIndex);
  return buildRtspUrl(config, password);
}

/** La fuente a usar hoy, o `null` si el modo IP está elegido pero sin host. */
export function resolveCameraSource(): string | null {
  const stored = readStored();
  return sourceFor(stored, decryptPassword(stored));
}

/**
 * URL para una config que todavía NO se guardó — el caso del botón "Probar".
 *
 * Si el panel no mandó contraseña es porque el usuario no la tocó, así que se
 * usa la guardada. Mantener esta resolución acá adentro es lo que permite que la
 * contraseña en claro no salga nunca del módulo.
 */
export function resolveSourceFor(input: CameraConfigInput): string | null {
  const password =
    input.password === undefined
      ? decryptPassword(readStored())
      : input.password;
  return sourceFor(input, password);
}

/** Lo que hay que inyectarle al `camera-service` al lanzarlo. */
export function cameraServiceEnv(): Record<string, string> {
  const stored = readStored();
  const source = sourceFor(stored, decryptPassword(stored));
  if (!source) {
    // Modo IP elegido pero sin host cargado. NO se setea CAMERA_SOURCE: el
    // servicio cae a su default (la webcam) y el equipo queda usable en vez de
    // quedarse sin video por una configuración a medio hacer.
    return {};
  }
  return {
    CAMERA_SOURCE: source,
    CAMERA_ID: stored.cameraId,
    CAMERA_LOCATION: stored.location,
  };
}
