// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { LocalEntry } from '../../lib/db/localDb';
import { ToastProvider } from '../../lib/notifications/ToastProvider';
import { InlineEntryField } from './InlineEntryField';

const h = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock('./entryInlineFields', () => ({ saveEntryInlineField: h.save }));

const entry = {
  id: 'entry-1',
  tenantId: 'tenant-1',
  plate: 'AAA111',
  notes: 'Nota anterior',
  cochera: 'A1',
} as LocalEntry;

let root: Root;
let container: HTMLDivElement;
const onRowClick = vi.fn();

async function render(
  field: 'notes' | 'cochera' = 'notes',
  disabledReason?: string,
) {
  await act(() =>
    Promise.resolve(
      root.render(
        <ToastProvider>
          <div onClick={onRowClick}>
            <InlineEntryField
              entry={entry}
              field={field}
              tenantId="tenant-1"
              accessToken="token"
              isOnline={false}
              disabledReason={disabledReason}
            />
          </div>
        </ToastProvider>,
      ),
    ),
  );
}

beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  h.save.mockReset();
  h.save.mockResolvedValue(true);
  onRowClick.mockClear();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(() => Promise.resolve(root.unmount()));
  container.remove();
});

it('edita y guarda la nota sin abrir la fila', async () => {
  await render();
  await act(() =>
    Promise.resolve(
      container
        .querySelector<HTMLButtonElement>('.dt-inline-field-trigger')!
        .click(),
    ),
  );
  expect(onRowClick).not.toHaveBeenCalled();

  const textarea = container.querySelector<HTMLTextAreaElement>('textarea')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      'value',
    )!.set!.call(textarea, 'Nota nueva');
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    await Promise.resolve();
  });
  await act(async () => {
    container
      .querySelector<HTMLButtonElement>('[aria-label="Guardar nota"]')!
      .click();
    await Promise.resolve();
  });

  expect(h.save).toHaveBeenCalledWith({
    tenantId: 'tenant-1',
    entryId: 'entry-1',
    accessToken: 'token',
    isOnline: false,
    field: 'notes',
    value: 'Nota nueva',
  });
  expect(onRowClick).not.toHaveBeenCalled();
});

it('edita la cochera en una línea y guarda con Enter sin abrir la fila', async () => {
  await render('cochera');
  await act(() =>
    Promise.resolve(
      container
        .querySelector<HTMLButtonElement>('.dt-inline-field-trigger')!
        .click(),
    ),
  );
  const input = container.querySelector<HTMLInputElement>('input')!;
  expect(input.maxLength).toBe(100);
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )!.set!.call(input, 'B2');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await Promise.resolve();
  });
  await act(async () => {
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
    );
    await Promise.resolve();
  });

  expect(h.save).toHaveBeenCalledWith({
    tenantId: 'tenant-1',
    entryId: 'entry-1',
    accessToken: 'token',
    isOnline: false,
    field: 'cochera',
    value: 'B2',
  });
  expect(onRowClick).not.toHaveBeenCalled();
});

it('no ofrece edición cuando la caja está cerrada', async () => {
  await render('notes', 'La caja está cerrada.');
  const trigger = container.querySelector<HTMLButtonElement>(
    '.dt-inline-field-trigger',
  )!;
  expect(trigger.getAttribute('aria-disabled')).toBe('true');
  await act(() => Promise.resolve(trigger.click()));
  expect(container.querySelector('textarea')).toBeNull();
  expect(onRowClick).not.toHaveBeenCalled();
});

it('cancela con Escape sin guardar ni cerrar el contenedor', async () => {
  await render();
  await act(() =>
    Promise.resolve(
      container
        .querySelector<HTMLButtonElement>('.dt-inline-field-trigger')!
        .click(),
    ),
  );
  const onDocumentKeyDown = vi.fn();
  document.addEventListener('keydown', onDocumentKeyDown);
  await act(() =>
    Promise.resolve(
      container
        .querySelector('textarea')!
        .dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
        ),
    ),
  );
  document.removeEventListener('keydown', onDocumentKeyDown);
  expect(container.querySelector('textarea')).toBeNull();
  expect(h.save).not.toHaveBeenCalled();
  expect(onDocumentKeyDown).not.toHaveBeenCalled();
});
