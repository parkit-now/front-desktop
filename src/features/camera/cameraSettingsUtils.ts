export const DEFAULT_CAMERA_ID = 'cam-01';
export const DEFAULT_CAMERA_PORT = 554;
export const DEFAULT_STREAM_PATH = '/h264_stream';

export type CameraAdvancedField = {
  key: keyof DesktopCameraTuning;
  label: string;
  step: number;
  modes?: Array<DesktopCameraConfig['mode']>;
};

export function cameraSourceSignature(
  input: Pick<
    DesktopCameraConfigInput,
    'mode' | 'deviceIndex' | 'host' | 'port' | 'streamPath' | 'username'
  >,
): string {
  if (input.mode === 'webcam') return `webcam:${input.deviceIndex}`;
  return [
    'ip',
    input.host.trim().toLowerCase(),
    String(input.port),
    input.username.trim().toLowerCase(),
    input.streamPath.trim() || DEFAULT_STREAM_PATH,
  ].join(':');
}

function slug(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
}

export function deriveCameraId(input: {
  mode: DesktopCameraConfig['mode'];
  host: string;
  deviceIndex: number;
  webcamLabel?: string;
}): string {
  if (input.mode === 'ip') {
    const host = input.host.trim();
    return host ? `ip-${slug(host) || host.replace(/\W+/g, '-')}` : 'ip-camara';
  }
  const label = input.webcamLabel?.trim();
  return label
    ? `webcam-${slug(label) || input.deviceIndex + 1}`
    : `webcam-${input.deviceIndex + 1}`;
}

export function shouldAutoReplaceCameraId(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized.length === 0 || normalized === DEFAULT_CAMERA_ID;
}

export function cameraDefaultsForMode(
  mode: DesktopCameraConfig['mode'],
  current: DesktopCameraConfigInput,
): DesktopCameraConfigInput {
  if (mode === 'webcam') {
    return {
      ...current,
      mode,
      deviceIndex: 0,
      cameraId: DEFAULT_CAMERA_ID,
    };
  }

  return {
    ...current,
    mode,
    host: '',
    port: DEFAULT_CAMERA_PORT,
    username: '',
    password: '',
    streamPath: DEFAULT_STREAM_PATH,
    cameraId: DEFAULT_CAMERA_ID,
  };
}

export function advancedFieldsForMode(
  fields: readonly CameraAdvancedField[],
  mode: DesktopCameraConfig['mode'],
): CameraAdvancedField[] {
  return fields.filter((field) => !field.modes || field.modes.includes(mode));
}
