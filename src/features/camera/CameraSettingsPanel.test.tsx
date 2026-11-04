// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  change,
  cleanup,
  click,
  mount,
  pageText,
  waitForText,
} from '../../test/dom';
import { CameraSettingsPanel } from './CameraSettingsPanel';

const entities = vi.hoisted(() => ({
  fetchEntityProfileSettings: vi.fn(),
  updateEntityDesktopCameraConfig: vi.fn(),
}));
const devices = vi.hoisted(() => ({ refresh: vi.fn() }));

vi.mock('../../lib/api/entities', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...entities,
}));
vi.mock('./useCameraStatus', () => ({
  useCameraStatus: () => ({
    camera: 'connected',
    downSince: null,
    reconnectAttempts: 0,
  }),
}));
vi.mock('./useWebcamDevices', () => ({
  useWebcamDevices: () => ({
    devices: [
      { index: 0, label: 'Cámara integrada' },
      { index: 1, label: 'Logitech C920' },
    ],
    labelled: true,
    loading: false,
    refresh: devices.refresh,
  }),
}));

const TUNING = {
  motionThreshold: 25,
  motionCooldown: 1,
  minConfidence: 0.8,
  discardBelow: 0.5,
  plateCooldown: 30,
  fallbackInterval: 5,
  clusterWindow: 2,
  clusterSettle: 1,
  plateMergeDistance: 1,
  moveMaxRatio: 0.2,
  fps: 10,
  width: 1280,
  height: 720,
  watchdogTimeout: 10,
  streamFps: 5,
  streamQuality: 70,
  streamMaxWidth: 640,
  roi: null,
};

function bridge(overrides: Record<string, unknown> = {}) {
  const value = {
    getCameraServiceStatus: vi.fn(() =>
      Promise.resolve({
        name: 'camera-service',
        state: 'managed',
        healthy: true,
        pid: 123,
      }),
    ),
    getCameraConfig: vi.fn(() =>
      Promise.resolve({
        mode: 'ip',
        deviceIndex: 0,
        host: '192.168.1.26',
        port: 554,
        username: 'admin',
        streamPath: '/stream1',
        cameraId: 'cam-entrada',
        location: 'entrada',
        hasPassword: true,
      }),
    ),
    setCameraConfig: vi.fn(() =>
      Promise.resolve({ ok: true, reconnected: true }),
    ),
    probeCamera: vi.fn(() =>
      Promise.resolve({ ok: true, width: 1280, height: 720 }),
    ),
    getCameraTuning: vi.fn(() => Promise.resolve(TUNING)),
    resetCameraTuning: vi.fn(() => Promise.resolve(TUNING)),
    startDesktopService: vi.fn(() =>
      Promise.resolve({
        name: 'camera-service',
        state: 'running',
        healthy: true,
        pid: 1,
      }),
    ),
    restartDesktopService: vi.fn(() =>
      Promise.resolve({
        name: 'camera-service',
        state: 'running',
        healthy: true,
        pid: 1,
      }),
    ),
    startCameraService: vi.fn(() =>
      Promise.resolve({
        name: 'camera-service',
        state: 'running',
        healthy: true,
        pid: 1,
      }),
    ),
    restartCameraService: vi.fn(() =>
      Promise.resolve({
        name: 'camera-service',
        state: 'running',
        healthy: true,
        pid: 1,
      }),
    ),
    onServiceCrashed: vi.fn(() => () => undefined),
    onServiceRecovered: vi.fn(() => () => undefined),
    onServicesFailed: vi.fn(),
    getFailedServices: vi.fn(() => Promise.resolve([])),
    ...overrides,
  };
  window.parkitDesktop = value as never;
  return value;
}

function render() {
  return mount(<CameraSettingsPanel tenantId="tenant" accessToken="token" />);
}

describe('CameraSettingsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    entities.fetchEntityProfileSettings.mockResolvedValue({
      desktopCameraConfig: null,
    });
    entities.updateEntityDesktopCameraConfig.mockResolvedValue({});
  });

  afterEach(async () => {
    delete window.parkitDesktop;
    await cleanup();
  });

  it('sin el puente de escritorio explica que no se puede configurar', async () => {
    await render();

    await waitForText('Configuración no disponible');
  });

  it('carga la cámara IP guardada y el estado del servicio', async () => {
    const desktop = bridge();
    await render();

    await waitForText('Servicio activo');
    expect(desktop.getCameraConfig).toHaveBeenCalled();
    expect(
      document.querySelector<HTMLInputElement>('#camera-host')!.value,
    ).toBe('192.168.1.26');
  });

  it('prueba la conexión y guarda la configuración', async () => {
    const desktop = bridge();
    await render();
    await waitForText('Servicio activo');

    await change(
      document.querySelector<HTMLInputElement>('#camera-host')!,
      '192.168.1.40',
    );
    await click('Probar conexión');
    expect(desktop.probeCamera).toHaveBeenCalledWith(
      expect.objectContaining({ host: '192.168.1.40' }),
    );

    await click('Guardar y reconectar');
    expect(desktop.setCameraConfig).toHaveBeenCalledWith(
      expect.objectContaining({ host: '192.168.1.40', mode: 'ip' }),
    );
  });

  it('avisa si la cámara no entrega video', async () => {
    bridge({
      probeCamera: vi.fn(() =>
        Promise.resolve({ ok: false, error: 'conecta_pero_no_entrega_video' }),
      ),
    });
    await render();
    await waitForText('Servicio activo');

    await click('Probar conexión');

    expect(pageText()).toMatch(/video/i);
  });

  it('pasa a webcam y elige el dispositivo', async () => {
    const desktop = bridge();
    await render();
    await waitForText('Servicio activo');

    await click('Webcam');
    await waitForText('Cámara integrada');
    await click('Actualizar lista');

    expect(devices.refresh).toHaveBeenCalled();
    expect(desktop.setCameraConfig).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'webcam' }),
    );
  });

  it('muestra los ajustes avanzados y los restablece', async () => {
    const desktop = bridge();
    await render();
    await waitForText('Servicio activo');

    await click('Mostrar ajustes avanzados');
    expect(pageText()).toContain('Ocultar ajustes avanzados');
    await click('Restablecer ajustes');
    const confirm = [...document.querySelectorAll('button')].filter((b) =>
      /Restablecer/.test(b.textContent ?? ''),
    );
    await click(confirm[confirm.length - 1]);

    expect(desktop.resetCameraTuning).toHaveBeenCalled();
  });

  it('activa el modo de prueba', async () => {
    bridge();
    await render();
    await waitForText('Servicio activo');

    const toggle = document.querySelector<HTMLInputElement>(
      '#camera-testing-mode',
    )!;
    await click(toggle);

    expect(
      localStorage.getItem('parkit.desktop.camera.testingMode'),
    ).not.toBeNull();
  });

  it('reinicia el servicio caído', async () => {
    const desktop = bridge({
      getCameraServiceStatus: vi.fn(() =>
        Promise.resolve({
          name: 'camera-service',
          state: 'failed',
          healthy: false,
          pid: null,
          lastError: 'exit 1',
        }),
      ),
    });
    await mount(
      <CameraSettingsPanel
        tenantId="tenant"
        accessToken="token"
        failedServices={['camera-service']}
      />,
    );
    await waitForText('Servicio detenido');

    const action = [...document.querySelectorAll('button')].find((b) =>
      /^(Abrir servicio|Iniciar|Reiniciar)/.test(b.textContent?.trim() ?? ''),
    );
    await click(action!);
    await waitForText('Servicio local iniciado.');

    expect(
      desktop.startDesktopService.mock.calls.length +
        desktop.restartDesktopService.mock.calls.length +
        desktop.startCameraService.mock.calls.length +
        desktop.restartCameraService.mock.calls.length,
    ).toBeGreaterThan(0);
  });
});
