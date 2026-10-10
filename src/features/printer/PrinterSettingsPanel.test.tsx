// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readCashSessionTemplateSettings } from '../../lib/print/cashSessionTemplate';
import { PrinterSettingsPanel } from './PrinterSettingsPanel';

const mock = vi.hoisted(() => ({
  toast: vi.fn(),
  print: vi.fn(),
}));

vi.mock('../../lib/notifications/ToastProvider', () => ({
  useToast: () => ({ showToast: mock.toast }),
}));

let root: Root;
let container: HTMLDivElement;
let previousDesktop: PropertyDescriptor | undefined;

beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.resetAllMocks();
  localStorage.clear();
  mock.print.mockResolvedValue({ ok: true });
  previousDesktop = Object.getOwnPropertyDescriptor(window, 'parkitDesktop');
  Object.defineProperty(window, 'parkitDesktop', {
    configurable: true,
    value: {
      platform: 'linux',
      listPrinters: vi.fn().mockResolvedValue([]),
      printTicket: mock.print,
    },
  });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(() => Promise.resolve(root.unmount()));
  container.remove();
  if (previousDesktop) {
    Object.defineProperty(window, 'parkitDesktop', previousDesktop);
  } else {
    Reflect.deleteProperty(window, 'parkitDesktop');
  }
  localStorage.clear();
});

async function render() {
  await act(() =>
    Promise.resolve(
      root.render(
        <PrinterSettingsPanel
          tenantId="tenant"
          tenantName="Apex"
          tenantAddress={null}
          actorRole="owner"
        />,
      ),
    ),
  );
}

async function clickButton(text: string, host: Element = container) {
  const button = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
    (item) => item.textContent?.trim() === text,
  )!;
  expect(button).toBeTruthy();
  await act(() => Promise.resolve(button.click()));
}

describe('plantilla de cierre en Impresora', () => {
  it('usa los mismos nombres en ambas pestañas y muestra el cierre', async () => {
    await render();
    const tablists = container.querySelectorAll('[role="tablist"]');
    expect(tablists).toHaveLength(2);
    for (const tabs of tablists) {
      expect(
        [...tabs.querySelectorAll('button')].map((button) =>
          button.textContent?.trim(),
        ),
      ).toEqual([
        'Ticket de ingreso',
        'Comprobante no fiscal',
        'Cierre de caja',
      ]);
    }

    await clickButton('Cierre de caja', tablists[0]);
    const preview = container.querySelector<HTMLIFrameElement>('iframe')!;
    expect(preview.srcdoc).toContain('Cierre de caja');
    expect(preview.srcdoc).toContain('Cobros por medio de pago');
    expect(preview.srcdoc).toContain('Mercado Pago');
    expect(container.textContent).toContain('Plantilla del cierre de caja');
    const heading = container.querySelector('.printer-template-heading')!;
    expect(heading.querySelector('h2')?.textContent).toBe(
      'Plantilla del cierre de caja',
    );
    expect(heading.querySelector('button')?.textContent).toContain('Restaurar');
  });

  it('actualiza vista previa, persistencia e impresión de prueba', async () => {
    await render();
    await clickButton('Cierre de caja');
    const label = [...container.querySelectorAll('label')].find(
      (item) => item.textContent?.trim() === 'Fondo inicial',
    )!;
    const checkbox = label.querySelector<HTMLInputElement>('input')!;
    await act(() => Promise.resolve(checkbox.click()));

    expect(
      readCashSessionTemplateSettings('tenant').fields.find(
        (field) => field.id === 'openingCash',
      )?.visible,
    ).toBe(false);
    const preview = container.querySelector<HTMLIFrameElement>('iframe')!;
    expect(preview.srcdoc).not.toContain('Fondo inicial');

    await clickButton('Imprimir prueba');
    const payload = mock.print.mock.calls[0][0] as { html: string };
    expect(payload.html).toBe(preview.srcdoc);
  });
});
