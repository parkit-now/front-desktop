// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ BrowserWindow: vi.fn() }));

import {
  buildTicketPageCss,
  cssPxToMicrons,
  mmToMicrons,
  ticketPageHeightMicrons,
} from './print.js';

describe('print sizing helpers', () => {
  it('convierte milímetros y px CSS a micrones', () => {
    expect(mmToMicrons(80)).toBe(80_000);
    expect(cssPxToMicrons(96)).toBe(25_400);
  });

  it('calcula el alto final sumando avance y respetando mínimo', () => {
    expect(ticketPageHeightMicrons(96, 10)).toBe(40_000);
    expect(ticketPageHeightMicrons(300, 10)).toBe(89_375);
  });

  it('genera CSS @page con ancho físico y alto medido', () => {
    const css = buildTicketPageCss({
      mediaWidthMm: 80,
      bodyWidthMm: 72,
      pageHeightMicrons: 89_375,
    });

    expect(css).toContain('@page { size: 80mm 89.375mm; margin: 0; }');
    expect(css).toContain('html, body { width: 72mm !important; }');
  });
});
