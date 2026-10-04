import { describe, expect, it, vi } from 'vitest';
import { dispatchEscape, pushEscapeHandler } from './useEscapeKey';

function key(over: Partial<Parameters<typeof dispatchEscape>[0]> = {}) {
  return {
    key: 'Escape',
    defaultPrevented: false,
    preventDefault: vi.fn(),
    ...over,
  };
}

describe('dispatchEscape', () => {
  it('llama solo al diálogo de arriba', () => {
    const bottom = vi.fn();
    const top = vi.fn();
    const off1 = pushEscapeHandler(bottom);
    const off2 = pushEscapeHandler(top);
    const event = key();
    expect(dispatchEscape(event)).toBe(true);
    expect(top).toHaveBeenCalledTimes(1);
    expect(bottom).not.toHaveBeenCalled();
    expect(event.preventDefault).toHaveBeenCalled();
    off2();
    dispatchEscape(key());
    expect(bottom).toHaveBeenCalledTimes(1);
    off1();
  });

  it('ignora otras teclas y Escape ya consumido por un select', () => {
    const handler = vi.fn();
    const off = pushEscapeHandler(handler);
    expect(dispatchEscape(key({ key: 'Enter' }))).toBe(false);
    expect(dispatchEscape(key({ defaultPrevented: true }))).toBe(false);
    expect(dispatchEscape(key({ isComposing: true }))).toBe(false);
    expect(handler).not.toHaveBeenCalled();
    off();
  });

  it('sin diálogos abiertos no hace nada', () => {
    expect(dispatchEscape(key())).toBe(false);
  });
});
