// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { LprEvent } from '../../lib/api/reports';
import { LprPhoto } from './AuditPanel';

const mock = vi.hoisted(() => ({ image: vi.fn() }));
vi.mock('../../lib/api/reports', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('../../lib/api/reports')>();
  return { ...original, getLprImageUrl: mock.image };
});

const detection = {
  id: 'lpr-1',
  imageStoragePath: 'photo.jpg',
  displayPlate: 'AB123CD',
  plateBbox: { x: 0.2, y: 0.3, w: 0.4, h: 0.2 },
} as LprEvent;
let root: Root;
let container: HTMLDivElement;

beforeEach(async () => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  mock.image.mockResolvedValue({
    url: 'https://example.test/photo.jpg',
    expiresIn: 300,
  });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(() =>
    Promise.resolve(
      root.render(
        <QueryClientProvider
          client={
            new QueryClient({ defaultOptions: { queries: { retry: false } } })
          }
        >
          <LprPhoto tenantId="playa-1" bearer="token" event={detection} />
        </QueryClientProvider>,
      ),
    ),
  );
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  mock.image.mockReset();
});

it('desactiva el arrastre nativo y desplaza la foto al arrastrar con zoom', () => {
  const trigger = container.querySelector<HTMLButtonElement>(
    'button.report-lpr-image',
  );
  expect(trigger).not.toBeNull();
  act(() => trigger?.click());
  const zoomButton =
    container.querySelector<HTMLButtonElement>('[title="Acercar"]');
  act(() => zoomButton?.click());
  const frame = container.querySelector<HTMLDivElement>(
    '.report-photo-viewport',
  );
  const stage = frame?.querySelector<HTMLDivElement>('.report-lpr-photo-stage');
  const image = stage?.querySelector('img');
  expect(frame).not.toBeNull();
  expect(stage).not.toBeNull();
  expect(image?.getAttribute('draggable')).toBe('false');
  frame!.setPointerCapture = vi.fn();
  frame!.releasePointerCapture = vi.fn();
  act(() => {
    frame?.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        pointerId: 1,
        button: 0,
        clientX: 10,
        clientY: 10,
      }),
    );
    frame?.dispatchEvent(
      new PointerEvent('pointermove', {
        bubbles: true,
        pointerId: 1,
        clientX: 50,
        clientY: 30,
      }),
    );
    frame?.dispatchEvent(
      new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }),
    );
  });
  expect(stage?.style.transform).toContain('translate(40px, 20px)');
  expect(frame?.classList.contains('is-dragging')).toBe(false);
});
