// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EntryDeleteAction } from './EntryDeleteAction';

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function render(blockers: string[], onClick = vi.fn()) {
  act(() =>
    root.render(
      <EntryDeleteAction
        plate="IAG574"
        blockers={blockers}
        onClick={onClick}
      />,
    ),
  );
  return { button: host.querySelector('button')!, onClick };
}

describe('EntryDeleteAction', () => {
  it('un bloqueo se anuncia al enfocar y no ejecuta la baja', () => {
    const { button, onClick } = render([
      'Tiene una factura emitida o en curso.',
    ]);
    expect(button.getAttribute('aria-disabled')).toBe('true');
    act(() => button.focus());
    const tooltip = document.querySelector('[role="tooltip"]');
    expect(tooltip?.textContent).toContain('factura');
    expect(button.getAttribute('aria-describedby')).toBe(tooltip?.id);
    act(() => button.click());
    expect(onClick).not.toHaveBeenCalled();
  });

  it('muestra el motivo al pasar el mouse', () => {
    const { button } = render(['La caja asociada está cerrada.']);
    act(() => {
      button.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    });
    expect(document.querySelector('[role="tooltip"]')?.textContent).toContain(
      'caja',
    );
  });

  it('el dueño puede abrir la confirmación si no hay bloqueos', () => {
    const { button, onClick } = render([]);
    act(() => button.click());
    expect(onClick).toHaveBeenCalledOnce();
  });
});
