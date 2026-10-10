// @vitest-environment happy-dom
import { StrictMode, act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it } from 'vitest';
import { MjpegImage } from './MjpegImage';

const container = document.createElement('div');
document.body.append(container);
const root = createRoot(container);
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(async () => {
  await act(() => Promise.resolve(root.render(null)));
});

it('mantiene el stream tras el remontaje de efectos de StrictMode y lo corta al desmontar', async () => {
  await act(() =>
    Promise.resolve(
      root.render(
        <StrictMode>
          <MjpegImage src="http://127.0.0.1:8766/stream/mjpeg" alt="Cámara" />
        </StrictMode>,
      ),
    ),
  );

  const img = container.querySelector('img');
  expect(img?.getAttribute('src')).toBe('http://127.0.0.1:8766/stream/mjpeg');

  await act(() => Promise.resolve(root.render(null)));
  expect(img?.hasAttribute('src')).toBe(false);
});
