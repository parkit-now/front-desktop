import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CAMERA_ID,
  DEFAULT_CAMERA_PORT,
  DEFAULT_STREAM_PATH,
  advancedFieldsForMode,
  cameraDefaultsForMode,
  cameraSourceSignature,
  deriveCameraId,
  validateCameraTuning,
  shouldAutoReplaceCameraId,
  type CameraAdvancedField,
} from './cameraSettingsUtils';

const tuning: DesktopCameraTuning = {
  motionThreshold: 1.5,
  motionCooldown: 3,
  minConfidence: 0.6,
  plateCooldown: 5,
  fallbackInterval: 300,
  clusterWindow: 5,
  clusterSettle: 1.2,
  plateMergeDistance: 3,
  moveMaxRatio: 0.15,
  fps: 10,
  width: 1280,
  height: 720,
  watchdogTimeout: 5,
  streamFps: 12,
  streamQuality: 70,
  roi: [1, 2, 3, 4],
};

const baseConfig: DesktopCameraConfigInput = {
  mode: 'webcam',
  deviceIndex: 2,
  host: '192.168.1.26',
  port: 8554,
  username: 'admin',
  streamPath: '/live',
  cameraId: 'entrada',
  location: 'entrada',
  tuning,
};

describe('camera settings helpers', () => {
  it('resets webcam fields without touching hidden IP fields or tuning', () => {
    expect(cameraDefaultsForMode('webcam', baseConfig)).toMatchObject({
      mode: 'webcam',
      deviceIndex: 0,
      host: '192.168.1.26',
      port: 8554,
      username: 'admin',
      streamPath: '/live',
      cameraId: DEFAULT_CAMERA_ID,
      tuning: baseConfig.tuning,
    });
  });

  it('resets IP fields and clears credentials without touching tuning', () => {
    expect(cameraDefaultsForMode('ip', baseConfig)).toMatchObject({
      mode: 'ip',
      host: '',
      port: DEFAULT_CAMERA_PORT,
      username: '',
      password: '',
      streamPath: DEFAULT_STREAM_PATH,
      cameraId: DEFAULT_CAMERA_ID,
      tuning: baseConfig.tuning,
    });
  });

  it('detects source changes by mode-specific source signatures', () => {
    expect(cameraSourceSignature(baseConfig)).toBe('webcam:2');
    expect(
      cameraSourceSignature({ ...baseConfig, mode: 'ip', host: 'CAM.local' }),
    ).toBe('ip:cam.local:8554:admin:/live');
  });

  it('derives readable camera identifiers', () => {
    expect(
      deriveCameraId({
        mode: 'webcam',
        deviceIndex: 0,
        host: '',
        webcamLabel: 'Logitech HD Pro',
      }),
    ).toBe('webcam-logitech-hd-pro');
    expect(
      deriveCameraId({
        mode: 'ip',
        deviceIndex: 0,
        host: '192.168.1.26',
      }),
    ).toBe('ip-192-168-1-26');
  });

  it('only auto-replaces empty/default camera IDs', () => {
    expect(shouldAutoReplaceCameraId('')).toBe(true);
    expect(shouldAutoReplaceCameraId(DEFAULT_CAMERA_ID)).toBe(true);
    expect(shouldAutoReplaceCameraId('entrada-principal')).toBe(false);
  });

  it('filters webcam-only advanced fields in IP mode', () => {
    const fields: CameraAdvancedField[] = [
      { key: 'streamFps', label: 'Preview', step: 1, hint: 'Preview' },
      {
        key: 'width',
        label: 'Ancho',
        step: 160,
        hint: 'Ancho',
        modes: ['webcam'],
      },
    ];

    expect(advancedFieldsForMode(fields, 'ip')).toEqual([fields[0]]);
    expect(advancedFieldsForMode(fields, 'webcam')).toEqual(fields);
  });
});

describe('validateCameraTuning', () => {
  it('marca clusterSettle cuando quedaría por debajo de motionCooldown', () => {
    const issues = validateCameraTuning({
      ...tuning,
      motionCooldown: 3,
      clusterSettle: 1.2,
      clusterWindow: 8,
      streamFps: 10,
    });

    expect(issues).toHaveLength(1);
    expect(issues[0]?.field).toBe('clusterSettle');
    expect(issues[0]?.message).toContain('3,5 s');
  });

  it('marca clusterWindow cuando no alcanza para recibir otra lectura', () => {
    const issues = validateCameraTuning({
      ...tuning,
      motionCooldown: 3,
      clusterSettle: 3.5,
      clusterWindow: 5,
      streamFps: 10,
    });

    expect(issues).toHaveLength(1);
    expect(issues[0]?.field).toBe('clusterWindow');
  });

  it('no marca valores de agrupamiento que ya son coherentes', () => {
    expect(
      validateCameraTuning({
        ...tuning,
        motionCooldown: 1.5,
        clusterSettle: 10,
        clusterWindow: 30,
        streamFps: 10,
      }),
    ).toEqual([]);
  });

  it('marca streamFps cuando supera el fps de captura', () => {
    const issues = validateCameraTuning({
      ...tuning,
      motionCooldown: 1.5,
      clusterSettle: 10,
      clusterWindow: 30,
      fps: 10,
      streamFps: 12,
    });

    expect(issues).toHaveLength(1);
    expect(issues[0]?.field).toBe('streamFps');
  });
});
