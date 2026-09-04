// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const appMock = vi.hoisted(() => ({ isPackaged: false }));
vi.mock('electron', () => ({ app: appMock }));

const existsSync = vi.hoisted(() => vi.fn<(p: string) => boolean>());
vi.mock('node:fs', () => ({ default: { existsSync }, existsSync }));

// Imported after the mocks are registered.
import { resolveServiceRuntime } from './serviceRuntime.js';

const ENV_KEYS = [
  'PARKIT_MANAGE_SERVICES',
  'PARKIT_SERVICES_DIR',
  'PARKIT_LPR_CMD',
  'PARKIT_CAMERA_CMD',
];

let originalPlatform: PropertyDescriptor | undefined;

function setPlatform(value: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value, configurable: true });
}

beforeEach(() => {
  appMock.isPackaged = false;
  existsSync.mockReset().mockReturnValue(false);
  for (const k of ENV_KEYS) delete process.env[k];
  originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
  setPlatform('linux');
  Object.defineProperty(process, 'resourcesPath', {
    value: '/opt/app/resources',
    configurable: true,
  });
});

afterEach(() => {
  if (originalPlatform) {
    Object.defineProperty(process, 'platform', originalPlatform);
  }
});

describe('resolveServiceRuntime', () => {
  it('does not manage when PARKIT_MANAGE_SERVICES=0', () => {
    process.env.PARKIT_MANAGE_SERVICES = '0';
    const rt = resolveServiceRuntime();
    expect(rt).toEqual({ manage: false, launchers: {} });
  });

  it('honours an explicit PARKIT_*_CMD over every other source', () => {
    appMock.isPackaged = true; // would otherwise win
    process.env.PARKIT_LPR_CMD = '/custom/lpr-service --verbose';

    const rt = resolveServiceRuntime(['lpr-service']);
    expect(rt.manage).toBe(true);
    expect(rt.launchers['lpr-service']).toMatchObject({
      cmd: '/custom/lpr-service',
      args: ['--verbose'],
      source: 'env',
    });
  });

  it('uses the bundled binary in process.resourcesPath when packaged', () => {
    appMock.isPackaged = true;

    const rt = resolveServiceRuntime(['camera-service']);
    expect(rt.launchers['camera-service']).toMatchObject({
      cmd: '/opt/app/resources/camera-service',
      args: [],
      source: 'packaged',
    });
  });

  it('prefers the venv python main.py when unpackaged', () => {
    existsSync.mockImplementation((p: string) =>
      p.endsWith('/.venv/bin/python'),
    );

    const rt = resolveServiceRuntime(['lpr-service']);
    expect(rt.launchers['lpr-service']).toMatchObject({
      args: ['main.py'],
      source: 'dev-source',
    });
  });

  it('picks the venv source over a stale built binary', () => {
    existsSync.mockImplementation(
      (p: string) =>
        p.endsWith('/.venv/bin/python') || p.endsWith('/dist/lpr-service'),
    );

    const rt = resolveServiceRuntime(['lpr-service']);
    expect(rt.launchers['lpr-service']?.source).toBe('dev-source');
  });

  it('falls back to the built binary when the venv is absent', () => {
    existsSync.mockImplementation((p: string) =>
      p.endsWith('/dist/lpr-service'),
    );

    const rt = resolveServiceRuntime(['lpr-service']);
    expect(rt.launchers['lpr-service']).toMatchObject({
      args: [],
      source: 'built-binary',
    });
    expect(rt.launchers['lpr-service']?.cmd).toMatch(
      /services\/lpr\/dist\/lpr-service$/,
    );
  });

  it('does not manage a service that resolves to nothing', () => {
    existsSync.mockReturnValue(false);
    const rt = resolveServiceRuntime(['lpr-service']);
    expect(rt).toEqual({ manage: false, launchers: {} });
  });

  it('adds the macOS OpenCV auth-skip env to the camera launcher', () => {
    setPlatform('darwin');
    appMock.isPackaged = true;

    const rt = resolveServiceRuntime(['camera-service']);
    expect(rt.launchers['camera-service']?.env).toEqual({
      OPENCV_AVFOUNDATION_SKIP_AUTH: '1',
    });
  });

  it('honours PARKIT_SERVICES_DIR for the unpackaged lookup', () => {
    process.env.PARKIT_SERVICES_DIR = '/somewhere/services';
    existsSync.mockImplementation(
      (p: string) =>
        p.startsWith('/somewhere/services/') &&
        p.endsWith('/dist/camera-service'),
    );

    const rt = resolveServiceRuntime(['camera-service']);
    expect(rt.launchers['camera-service']?.cmd).toBe(
      '/somewhere/services/camera/dist/camera-service',
    );
  });
});
