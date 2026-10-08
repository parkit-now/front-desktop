// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  detections: [{ id: 'one' }, { id: 'two' }],
  dismissAll: vi.fn(),
  toast: vi.fn(),
}));

vi.mock('./useCameraDetections', () => ({
  useCameraDetections: () => ({
    detections: mock.detections,
    dismiss: vi.fn(),
    dismissAll: mock.dismissAll,
    ack: vi.fn(),
  }),
}));
vi.mock('./testingMode', () => ({ useCameraTestingMode: () => false }));
vi.mock('./AutoEntryCard', () => ({
  AutoEntryCard: ({ detection }: { detection: { id: string } }) => (
    <div data-detection-id={detection.id} />
  ),
}));
vi.mock('../../lib/notifications/ToastProvider', () => ({
  useToast: () => ({ showToast: mock.toast }),
}));

import { AutoEntriesColumns } from './AutoEntriesColumns';

let container: HTMLDivElement;
let root: Root;

async function render() {
  await act(() =>
    Promise.resolve(
      root.render(<AutoEntriesColumns tenantId="tenant" accessToken="token" />),
    ),
  );
}

async function click(button: HTMLButtonElement) {
  await act(() => Promise.resolve(button.click()));
}

beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  mock.detections = [{ id: 'one' }, { id: 'two' }];
  mock.dismissAll.mockReset().mockResolvedValue({ dismissed: 2, failed: 0 });
  mock.toast.mockReset();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(() => Promise.resolve(root.unmount()));
  container.remove();
});

describe('descartar todas las detecciones', () => {
  it('muestra la acción junto al contador y no descarta al cancelar', async () => {
    await render();
    const count = container.querySelector('.auto-entries__count');
    const clear = container.querySelector<HTMLButtonElement>(
      '.auto-entries__clear',
    );
    expect(count?.textContent).toBe('2');
    expect(count?.nextElementSibling).toBe(clear);
    expect(clear?.getAttribute('title')).toBe(
      'Descartar todas las detecciones',
    );

    await click(clear!);
    expect(
      container.querySelector('[role="alertdialog"]')?.textContent,
    ).toContain('Se descartarán 2 detecciones pendientes');
    await click(
      [...container.querySelectorAll<HTMLButtonElement>('button')].find(
        (button) => button.textContent === 'Cancelar',
      )!,
    );
    expect(mock.dismissAll).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alertdialog"]')).toBeNull();
  });

  it('descarta sólo las tarjetas visibles al abrir la confirmación', async () => {
    await render();
    await click(
      container.querySelector<HTMLButtonElement>('.auto-entries__clear')!,
    );
    mock.detections = [{ id: 'one' }, { id: 'two' }, { id: 'new' }];
    await render();

    await click(
      [...container.querySelectorAll<HTMLButtonElement>('button')].find(
        (button) => button.textContent === 'Descartar todas',
      )!,
    );

    expect(mock.dismissAll).toHaveBeenCalledExactlyOnceWith(['one', 'two']);
    expect(mock.toast).toHaveBeenCalledWith({
      message: '2 detecciones descartadas.',
      kind: 'success',
    });
    expect(container.querySelector('[role="alertdialog"]')).toBeNull();
  });

  it('bloquea una segunda confirmación mientras se descarta', async () => {
    let finish!: (result: { dismissed: number; failed: number }) => void;
    mock.dismissAll.mockImplementation(
      () => new Promise((resolve) => (finish = resolve)),
    );
    await render();
    await click(
      container.querySelector<HTMLButtonElement>('.auto-entries__clear')!,
    );
    const confirm = [
      ...container.querySelectorAll<HTMLButtonElement>('button'),
    ].find((button) => button.textContent === 'Descartar todas')!;
    await click(confirm);
    expect(confirm.disabled).toBe(true);
    await click(confirm);
    expect(mock.dismissAll).toHaveBeenCalledTimes(1);

    await act(() => Promise.resolve(finish({ dismissed: 2, failed: 0 })));
    expect(container.querySelector('[role="alertdialog"]')).toBeNull();
  });

  it('oculta la acción si no hay detecciones', async () => {
    mock.detections = [];
    await render();
    expect(container.querySelector('.auto-entries__clear')).toBeNull();
  });
});
