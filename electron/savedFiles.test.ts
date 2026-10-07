// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({ stat: vi.fn(), reveal: vi.fn() }));
vi.mock('electron', () => ({ shell: { showItemInFolder: mock.reveal } }));
vi.mock('node:fs', () => ({ default: { promises: { stat: mock.stat } } }));

import { rememberSavedFile, showSavedFileInFolder } from './savedFiles.js';

beforeEach(() => {
  vi.resetAllMocks();
  mock.stat.mockResolvedValue({ isFile: () => true });
});

describe('mostrar archivos guardados en carpeta', () => {
  it('abre el explorador con el archivo guardado seleccionado', async () => {
    const filePath = '/tmp/factura-guardada.pdf';
    rememberSavedFile(filePath);
    expect(await showSavedFileInFolder(filePath)).toEqual({ ok: true });
    expect(mock.stat).toHaveBeenCalledWith(filePath);
    expect(mock.reveal).toHaveBeenCalledWith(filePath);
  });

  it.each([null, undefined, 42, {}, '/tmp/no-guardado.pdf'])(
    'rechaza rutas no autorizadas o payloads invalidos: %s',
    async (value) => {
      expect(await showSavedFileInFolder(value)).toEqual({ ok: false });
      expect(mock.stat).not.toHaveBeenCalled();
      expect(mock.reveal).not.toHaveBeenCalled();
    },
  );

  it('no intenta abrir un archivo eliminado o movido', async () => {
    const filePath = '/tmp/factura-eliminada.pdf';
    rememberSavedFile(filePath);
    mock.stat.mockRejectedValue(new Error('ENOENT'));
    expect(await showSavedFileInFolder(filePath)).toEqual({ ok: false });
    expect(mock.reveal).not.toHaveBeenCalled();
  });

  it('rechaza una ruta que ahora es un directorio', async () => {
    const filePath = '/tmp/factura-directorio.pdf';
    rememberSavedFile(filePath);
    mock.stat.mockResolvedValue({ isFile: () => false });
    expect(await showSavedFileInFolder(filePath)).toEqual({ ok: false });
    expect(mock.reveal).not.toHaveBeenCalled();
  });

  it('maneja un error del explorador sin rechazar el IPC', async () => {
    const filePath = '/tmp/factura-error.pdf';
    rememberSavedFile(filePath);
    mock.reveal.mockImplementation(() => {
      throw new Error('failed');
    });
    expect(await showSavedFileInFolder(filePath)).toEqual({ ok: false });
  });
});
