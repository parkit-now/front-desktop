/**
 * Helpers para tests de paneles con happy-dom: montan con `createRoot`
 * dentro de `act`, como los tests existentes, y traen la base local real
 * sobre `fake-indexeddb`.
 *
 * El archivo de test tiene que declarar `// @vitest-environment happy-dom` e
 * importar `fake-indexeddb/auto` ANTES que cualquier módulo que abra la base.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { expect } from 'vitest';
import { localDb } from '../lib/db/localDb';
import { ToastProvider } from '../lib/notifications/ToastProvider';

type Mounted = { container: HTMLDivElement; root: Root; client: QueryClient };

let mounted: Mounted[] = [];

/** Monta `ui` con toasts y React Query (para los paneles de reportes). */
export async function mount(ui: ReactNode): Promise<HTMLDivElement> {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  await act(() =>
    Promise.resolve(
      root.render(
        <QueryClientProvider client={client}>
          <ToastProvider>{ui}</ToastProvider>
        </QueryClientProvider>,
      ),
    ),
  );
  mounted.push({ container, root, client });
  await settle();
  return container;
}

/** Desmonta lo montado y vacía la base local (para `afterEach`). */
export async function cleanup(): Promise<void> {
  for (const { container, root, client } of mounted) {
    await act(() => Promise.resolve(root.unmount()));
    client.clear();
    container.remove();
  }
  mounted = [];
  document.body.innerHTML = '';
  await Promise.all(localDb.tables.map((table) => table.clear()));
}

/** Deja correr promesas, timers en cero y las queries de Dexie. */
export async function settle(rounds = 8): Promise<void> {
  for (let index = 0; index < rounds; index += 1) {
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
  }
}

function text(element: Element): string {
  return (element.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/** Texto visible de toda la página. */
export function pageText(): string {
  return text(document.body);
}

/** Espera a que aparezca `expected` (Dexie avisa los cambios con demora). */
export async function waitForText(
  expected: string,
  timeoutMs = 3000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!pageText().includes(expected) && Date.now() < deadline) {
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, 20)));
  }
  expect(pageText()).toContain(expected);
}

/** Botón cuyo texto o `aria-label` coincide. */
export function button(
  label: string | RegExp,
  host: ParentNode = document.body,
): HTMLElement {
  const match = (value: string | null | undefined) =>
    value != null &&
    (typeof label === 'string' ? value === label : label.test(value));
  const found = [
    ...host.querySelectorAll<HTMLElement>('button, a, [role="button"]'),
  ].find(
    (element) =>
      match(text(element)) || match(element.getAttribute('aria-label')),
  );
  expect(found, `botón "${String(label)}"`).toBeTruthy();
  return found!;
}

export async function click(
  target: HTMLElement | string | RegExp,
  host: ParentNode = document.body,
): Promise<void> {
  const element =
    typeof target === 'string' || target instanceof RegExp
      ? button(target, host)
      : target;
  await act(() => Promise.resolve(element.click()));
  await settle();
}

/** Cambia el valor de un input/textarea/select como lo haría el usuario. */
export async function change(
  element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  value: string,
): Promise<void> {
  // El setter del prototipo, no el de la instancia: React lo intercepta para
  // saber que el valor cambió y disparar su onChange.
  const prototype = Object.getPrototypeOf(element) as object;
  await act(() => {
    Reflect.set(prototype, 'value', value, element);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    return Promise.resolve();
  });
  await settle();
}

/** Input por `aria-label`, `placeholder` o el texto de su `<label>`. */
export function field<
  T extends HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement =
    HTMLInputElement,
>(label: string, host: ParentNode = document.body): T {
  const byAttribute = host.querySelector<T>(
    `[aria-label="${label}"], [placeholder="${label}"]`,
  );
  if (byAttribute) return byAttribute;
  const labelElement = [...host.querySelectorAll('label')].find((element) =>
    text(element).startsWith(label),
  );
  const control =
    (labelElement?.htmlFor &&
      host.querySelector<T>(`#${CSS.escape(labelElement.htmlFor)}`)) ||
    labelElement?.querySelector<T>('input, textarea, select');
  expect(control, `campo "${label}"`).toBeTruthy();
  return control as T;
}

/**
 * Elige `label` en un `AppSelect` (abre la lista y la toca). `select` es su
 * `id` o, si no tiene, el texto del `<label>` que lo envuelve.
 */
export async function choose(
  select: string,
  label: string | RegExp,
): Promise<void> {
  const trigger =
    document.getElementById(select) ??
    [...document.querySelectorAll('label')]
      .find((element) => text(element).startsWith(select))
      ?.querySelector<HTMLElement>('[role="combobox"]');
  expect(trigger, `select "${select}"`).toBeTruthy();
  await click(trigger!);
  const option = [
    ...document.querySelectorAll<HTMLElement>('[role="option"]'),
  ].find((element) =>
    typeof label === 'string'
      ? text(element).startsWith(label)
      : label.test(text(element)),
  );
  expect(option, `opción "${String(label)}"`).toBeTruthy();
  await act(() => {
    option!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    return Promise.resolve();
  });
  await settle();
}

/** Espera a que exista un elemento con ese selector y lo devuelve. */
export async function waitForElement<T extends HTMLElement = HTMLElement>(
  selector: string,
  timeoutMs = 3000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (!document.querySelector(selector) && Date.now() < deadline) {
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, 20)));
  }
  const element = document.querySelector<T>(selector);
  expect(element, `elemento "${selector}"`).toBeTruthy();
  return element!;
}
