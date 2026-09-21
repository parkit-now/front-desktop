// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const appMock = vi.hoisted(() => ({ getPath: () => '/tmp/parkit-test' }));
const safeStorageMock = vi.hoisted(() => ({
  isEncryptionAvailable: vi.fn(() => true),
  encryptString: vi.fn((value: string) => Buffer.from(`enc:${value}`)),
  decryptString: vi.fn((buf: Buffer) =>
    buf.toString('utf8').replace(/^enc:/, ''),
  ),
}));
vi.mock('electron', () => ({ app: appMock, safeStorage: safeStorageMock }));

// El "disco": un solo archivo en memoria.
const disk = vi.hoisted(() => ({ content: null as string | null }));
const fsMock = vi.hoisted(() => ({
  readFileSync: vi.fn(() => {
    if (disk.content === null) throw new Error('ENOENT');
    return disk.content;
  }),
  writeFileSync: vi.fn((_p: string, data: string) => {
    disk.content = data;
  }),
}));
vi.mock('node:fs', () => ({ default: fsMock, ...fsMock }));

// Imported after the mocks are registered.
import {
  cameraServiceEnv,
  readCameraConfig,
  resolveSourceFor,
  writeCameraConfig,
} from './cameraConfig.js';

const BASE = {
  mode: 'ip' as const,
  deviceIndex: 0,
  host: '192.168.1.26',
  port: 554,
  username: 'admin',
  streamPath: '/h264_stream',
  cameraId: 'cam-entrada',
  location: 'entrada' as const,
};

beforeEach(() => {
  disk.content = null;
  safeStorageMock.isEncryptionAvailable.mockReturnValue(true);
  vi.clearAllMocks();
});

describe('cameraConfig', () => {
  it('un equipo nuevo arranca en webcam 0, como venía funcionando', () => {
    expect(cameraServiceEnv()).toEqual({
      CAMERA_SOURCE: '0',
      CAMERA_ID: 'cam-01',
      CAMERA_LOCATION: 'entrada',
    });
  });

  it('en modo webcam la fuente es el índice del dispositivo', () => {
    writeCameraConfig({ ...BASE, mode: 'webcam', deviceIndex: 2 });

    expect(cameraServiceEnv().CAMERA_SOURCE).toBe('2');
  });

  it('modo IP sin host no setea CAMERA_SOURCE: el servicio cae a la webcam', () => {
    // Una configuración a medio hacer tiene que dejar el equipo usable, no sin
    // video.
    writeCameraConfig({ ...BASE, host: '', password: '' });

    expect(cameraServiceEnv()).toEqual({});
  });

  it('cambiar a webcam conserva la cámara IP para volver', () => {
    writeCameraConfig({ ...BASE, password: 'QFMUDK' });
    writeCameraConfig({ ...BASE, mode: 'webcam', deviceIndex: 1 });

    expect(cameraServiceEnv().CAMERA_SOURCE).toBe('1');

    // Sin re-mandar la contraseña: el panel no la re-envía si no se tocó.
    writeCameraConfig({ ...BASE, mode: 'ip' });
    expect(cameraServiceEnv().CAMERA_SOURCE).toBe(
      'rtsp://admin:QFMUDK@192.168.1.26:554/h264_stream',
    );
  });

  describe('migración de un camera.json anterior al switch', () => {
    it('con host guardado se asume que estaba usando la cámara IP', () => {
      disk.content = JSON.stringify({
        host: '10.0.0.5',
        port: 554,
        username: 'admin',
        password: 'plana',
        passwordEncrypted: false,
        streamPath: '/s',
        cameraId: 'cam-01',
        location: 'entrada',
      });

      expect(readCameraConfig().mode).toBe('ip');
      expect(cameraServiceEnv().CAMERA_SOURCE).toBe(
        'rtsp://admin:plana@10.0.0.5:554/s',
      );
    });

    it('sin host guardado se asume webcam', () => {
      disk.content = JSON.stringify({ host: '', cameraId: 'cam-01' });

      expect(readCameraConfig().mode).toBe('webcam');
      expect(cameraServiceEnv().CAMERA_SOURCE).toBe('0');
    });
  });

  it('arma la URL RTSP y la pasa como env del servicio', () => {
    writeCameraConfig({ ...BASE, password: 'QFMUDK' });

    expect(cameraServiceEnv()).toEqual({
      CAMERA_SOURCE: 'rtsp://admin:QFMUDK@192.168.1.26:554/h264_stream',
      CAMERA_ID: 'cam-entrada',
      CAMERA_LOCATION: 'entrada',
    });
  });

  /**
   * LA GARANTÍA QUE SOSTIENE TODO EL DISEÑO.
   *
   * La contraseña de la cámara no puede llegar al renderer: desde ahí la ve
   * cualquiera que abra el DevTools. `readCameraConfig` es lo único que cruza el
   * puente IPC, así que si algún día alguien agrega el campo "porque es cómodo",
   * este test lo frena.
   */
  it('nunca devuelve la contraseña al renderer', () => {
    writeCameraConfig({ ...BASE, password: 'QFMUDK' });

    const config = readCameraConfig();

    expect(config.hasPassword).toBe(true);
    expect(JSON.stringify(config)).not.toContain('QFMUDK');
    expect('password' in config).toBe(false);
  });

  it('cifra la contraseña en disco cuando el sistema lo permite', () => {
    writeCameraConfig({ ...BASE, password: 'QFMUDK' });

    expect(disk.content).not.toContain('QFMUDK');
    expect(safeStorageMock.encryptString).toHaveBeenCalledWith('QFMUDK');
  });

  it('guarda igual si el sistema no ofrece cifrado, en vez de dejar sin cámara', () => {
    // Linux sin keyring. Preferimos una config que funcione con un warning
    // antes que un equipo que no puede detectar patentes.
    safeStorageMock.isEncryptionAvailable.mockReturnValue(false);

    writeCameraConfig({ ...BASE, password: 'QFMUDK' });

    expect(cameraServiceEnv().CAMERA_SOURCE).toContain('QFMUDK');
  });

  it('omitir la contraseña conserva la guardada', () => {
    writeCameraConfig({ ...BASE, password: 'QFMUDK' });
    // El panel manda el resto de los campos sin la clave porque el usuario no
    // la tocó. Si esto la borrara, cambiar el puerto dejaría la cámara sin
    // credencial y sin video.
    writeCameraConfig({ ...BASE, port: 8554 });

    expect(cameraServiceEnv().CAMERA_SOURCE).toBe(
      'rtsp://admin:QFMUDK@192.168.1.26:8554/h264_stream',
    );
  });

  it('escapa credenciales con caracteres especiales', () => {
    // Una contraseña con `@` o `/` sin escapar parte la URL y la cámara
    // "no conecta" por un motivo imposible de deducir mirando la pantalla.
    writeCameraConfig({ ...BASE, username: 'a d', password: 'p@ss/w:rd' });

    expect(cameraServiceEnv().CAMERA_SOURCE).toBe(
      'rtsp://a%20d:p%40ss%2Fw%3Ard@192.168.1.26:554/h264_stream',
    );
  });

  it('probar una config sin guardar usa la contraseña ya guardada', () => {
    writeCameraConfig({ ...BASE, password: 'QFMUDK' });

    const source = resolveSourceFor({ ...BASE, host: '10.0.0.9' });

    expect(source).toBe('rtsp://admin:QFMUDK@10.0.0.9:554/h264_stream');
  });

  it('sin host no hay URL que armar', () => {
    expect(
      resolveSourceFor({ ...BASE, host: '   ', password: 'x' }),
    ).toBeNull();
  });

  it('un archivo corrupto degrada a la webcam y no tira', () => {
    disk.content = '{{{ no es json';

    expect(() => readCameraConfig()).not.toThrow();
    expect(cameraServiceEnv().CAMERA_SOURCE).toBe('0');
  });
});
