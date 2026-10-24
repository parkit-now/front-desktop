import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

/**
 * Config de los tests, aparte de la de Vite (mismo criterio que front-web).
 * Cada test elige su entorno con `// @vitest-environment`; acá sólo vive el
 * reporte de cobertura: el renderer y el proceso de Electron, sin los scripts
 * de build.
 */
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      coverage: {
        provider: 'v8',
        include: ['src/**/*.{ts,tsx}', 'electron/**/*.{ts,cts}'],
        exclude: [
          '**/*.test.{ts,tsx}',
          'src/test/**',
          'src/generated/**',
          '**/*.d.ts',
        ],
      },
    },
  }),
);
