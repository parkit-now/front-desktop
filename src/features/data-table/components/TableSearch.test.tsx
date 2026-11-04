// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { act, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  button,
  change,
  cleanup,
  click,
  field,
  mount,
} from '../../../test/dom';
import { pushEscapeHandler } from '../../../lib/ui/useEscapeKey';
import { TableSearch } from './TableSearch';

const modes = [
  { id: 'all', label: 'Todos' },
  { id: 'ticket', label: 'Ticket', placeholder: 'Buscar por ticket' },
  { id: 'plate', label: 'Patente', placeholder: 'Buscar por patente' },
];

function SearchExample({ withModes = true, initialMode = 'all' }) {
  const [query, setQuery] = useState('66');
  const [modeId, setModeId] = useState(initialMode);
  return (
    <>
      <TableSearch
        value={query}
        onChange={setQuery}
        placeholder="Buscar..."
        modes={withModes ? modes : undefined}
        modeId={modeId}
        onModeChange={setModeId}
      />
      <button type="button">Fuera</button>
    </>
  );
}

async function key(element: HTMLElement, value: string, shiftKey = false) {
  await act(() => {
    element.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: value,
        shiftKey,
        bubbles: true,
        cancelable: true,
      }),
    );
    return Promise.resolve();
  });
}

afterEach(cleanup);

describe('TableSearch', () => {
  it('funciona sin modos y limpia la consulta devolviendo el foco al input', async () => {
    const container = await mount(<SearchExample withModes={false} />);
    expect(
      container.querySelector('[aria-label="Campo de búsqueda"]'),
    ).toBeNull();
    await change(field('Buscar en la tabla'), 'Peugeot');
    await click('Limpiar búsqueda');
    expect(field('Buscar en la tabla').value).toBe('');
    expect(document.activeElement).toBe(field('Buscar en la tabla'));
    expect(container.querySelector('[title="Limpiar búsqueda"]')).toBeNull();
  });

  it('integra la flecha después de la cruz y marca la opción activa sin un selector externo', async () => {
    const container = await mount(<SearchExample />);
    const trigger = button('Campo de búsqueda');
    expect(trigger.previousElementSibling).toBe(button('Limpiar búsqueda'));
    expect(trigger.closest('.dt-search')).toBeTruthy();
    expect(container.querySelector('select')).toBeNull();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    await click(trigger);
    const selected = container.querySelector(
      '[role="menuitemradio"][aria-checked="true"]',
    );
    expect(selected?.textContent).toBe('Todos');
    expect(selected?.querySelector('svg')).toBeTruthy();
    expect(document.activeElement).toBe(selected);
    expect(trigger.getAttribute('aria-controls')).toBe(
      container.querySelector('[role="menu"]')?.id,
    );
    await click('Ticket');
    expect(trigger.title).toBe('Buscar en: Ticket');
    expect(field('Buscar en la tabla').placeholder).toBe('Buscar por ticket');
    expect(field('Buscar en la tabla').value).toBe('66');
    expect(document.activeElement).toBe(field('Buscar en la tabla'));
    expect(container.querySelector('[role="menu"]')).toBeNull();
  });

  it('mantiene el modo al limpiar y muestra la flecha con el buscador vacío', async () => {
    const container = await mount(<SearchExample initialMode="plate" />);
    await click('Limpiar búsqueda');
    expect(button('Campo de búsqueda').title).toBe('Buscar en: Patente');
    await click('Campo de búsqueda');
    expect(container.querySelector('[aria-checked="true"]')?.textContent).toBe(
      'Patente',
    );
  });

  it('cierra al tocar nuevamente la flecha, hacer clic afuera o volver al input', async () => {
    const container = await mount(<SearchExample />);
    await click('Campo de búsqueda');
    await click('Campo de búsqueda');
    expect(container.querySelector('[role="menu"]')).toBeNull();
    await click('Campo de búsqueda');
    await act(() => {
      button('Fuera').dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true }),
      );
      return Promise.resolve();
    });
    expect(container.querySelector('[role="menu"]')).toBeNull();
    await click('Campo de búsqueda');
    await act(() => {
      field('Buscar en la tabla').focus();
      return Promise.resolve();
    });
    expect(container.querySelector('[role="menu"]')).toBeNull();
  });

  it('permite navegar con flechas, Inicio y Fin y elegir con Enter o Espacio', async () => {
    await mount(<SearchExample />);
    const trigger = button('Campo de búsqueda');
    await key(trigger, 'ArrowDown');
    expect(document.activeElement?.textContent).toBe('Todos');
    await key(document.activeElement as HTMLElement, 'ArrowUp');
    expect(document.activeElement?.textContent).toBe('Patente');
    await key(document.activeElement as HTMLElement, 'Home');
    expect(document.activeElement?.textContent).toBe('Todos');
    await key(document.activeElement as HTMLElement, 'ArrowDown');
    expect(document.activeElement?.textContent).toBe('Ticket');
    await key(document.activeElement as HTMLElement, 'Enter');
    expect(trigger.title).toBe('Buscar en: Ticket');
    await key(trigger, 'ArrowUp');
    expect(document.activeElement?.textContent).toBe('Patente');
    await key(document.activeElement as HTMLElement, 'Home');
    await key(document.activeElement as HTMLElement, 'End');
    expect(document.activeElement?.textContent).toBe('Patente');
    await key(document.activeElement as HTMLElement, ' ');
    expect(trigger.title).toBe('Buscar en: Patente');
  });

  it('consume Escape sin cerrar el diálogo contenedor y devuelve el foco a la flecha', async () => {
    const closeDialog = vi.fn();
    const remove = pushEscapeHandler(closeDialog);
    try {
      const container = await mount(<SearchExample />);
      await click('Campo de búsqueda');
      await key(document.activeElement as HTMLElement, 'Escape');
      expect(container.querySelector('[role="menu"]')).toBeNull();
      expect(closeDialog).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(button('Campo de búsqueda'));
    } finally {
      remove();
    }
  });

  it('cierra con Tab o al mover el foco fuera del buscador', async () => {
    const container = await mount(<SearchExample />);
    await click('Campo de búsqueda');
    await key(document.activeElement as HTMLElement, 'Tab');
    expect(container.querySelector('[role="menu"]')).toBeNull();
    await click('Campo de búsqueda');
    await act(() => {
      button('Fuera').focus();
      return Promise.resolve();
    });
    expect(container.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(button('Fuera'));
  });
});
