// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PendingDetection } from './useCameraDetections';

const mock = vi.hoisted(() => ({
  signedUrl: vi.fn(),
  isOnline: true,
}));

vi.mock('../../lib/api/lpr-events', () => ({
  getLprDetectionEventImageSignedUrl: mock.signedUrl,
}));
vi.mock('../../lib/network/NetworkContext', () => ({
  useNetwork: () => ({ isOnline: mock.isOnline }),
}));
vi.mock('./useCameraDetections', () => ({
  CAMERA_BASE_URL: 'http://127.0.0.1:8766',
}));

import { DetectionImageDialog } from './DetectionImageDialog';

const timestamp = '2026-10-08T12:00:00.000Z';
const detection: PendingDetection = {
  id: 'event-1',
  tenantId: 'tenant-1',
  cameraId: 'cam-1',
  location: 'entrada',
  firstSeenAt: timestamp,
  lastSeenAt: timestamp,
  normalizedText: 'AB123CD',
  confidence: 0.9,
  formatValid: true,
  formatType: 'argentina_mercosur',
  qualityStatus: 'valid_high',
  status: 'registered',
  bestCaptureId: 'capture-1',
  imageStoragePath: 'tenant-1/event-1.jpg',
  candidates: [],
  version: 1,
  syncSeq: 1,
  createdAt: timestamp,
  updatedAt: timestamp,
};

let container: HTMLDivElement;
let root: Root;

async function render(image: PendingDetection) {
  await act(() =>
    Promise.resolve(
      root.render(
        <DetectionImageDialog
          detection={image}
          tenantId="tenant-1"
          accessToken="token"
          onClose={() => undefined}
        />,
      ),
    ),
  );
}

async function failImage() {
  const image = container.querySelector('img');
  expect(image).not.toBeNull();
  await act(() =>
    Promise.resolve(
      image!.dispatchEvent(new Event('error', { bubbles: true })),
    ),
  );
}

beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  mock.isOnline = true;
  mock.signedUrl.mockReset().mockResolvedValue({
    url: 'https://storage.example/event-1.jpg?token=signed',
    expiresIn: 300,
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(() => Promise.resolve(root.unmount()));
  container.remove();
});

describe('DetectionImageDialog', () => {
  it('usa primero la captura local y recurre al backend si falta', async () => {
    await render(detection);
    expect(container.querySelector('img')?.getAttribute('src')).toBe(
      'http://127.0.0.1:8766/capture/capture-1/image.jpg',
    );
    expect(mock.signedUrl).not.toHaveBeenCalled();

    await failImage();
    expect(mock.signedUrl).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      bearer: 'token',
      eventId: 'event-1',
    });
    expect(container.querySelector('img')?.getAttribute('src')).toBe(
      'https://storage.example/event-1.jpg?token=signed',
    );
  });

  it('carga la foto remota cuando esta PC no tiene captura', async () => {
    await render({ ...detection, bestCaptureId: undefined });
    expect(mock.signedUrl).toHaveBeenCalledTimes(1);
    expect(container.querySelector('img')?.getAttribute('src')).toBe(
      'https://storage.example/event-1.jpg?token=signed',
    );
  });

  it('no consulta el backend sin conexion', async () => {
    mock.isOnline = false;
    await render(detection);
    await failImage();
    expect(mock.signedUrl).not.toHaveBeenCalled();
    expect(container.textContent).toContain('No se pudo cargar la imagen.');
  });

  it('deja la imagen no disponible si el backend ya no la conserva', async () => {
    mock.signedUrl.mockRejectedValue(new Error('404'));
    await render({ ...detection, bestCaptureId: undefined });
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('No se pudo cargar la imagen.');
  });
});
