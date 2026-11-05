import { describe, expect, it } from 'vitest';
import { ApiError } from './client';
import { translateApiError } from './translate';
import { SyncError } from '../sync/SyncError';

describe('errores de sincronización', () => {
  it('identifica la etapa y traduce el error original por estado HTTP', () => {
    const error = new SyncError([
      {
        stage: 'ingresos',
        error: new ApiError(500, 'internal database detail', null),
      },
    ]);
    expect(translateApiError(error)).toBe(
      'ingresos: El servidor no responde. Intentalo en unos segundos.',
    );
  });

  it('conserva la causa de una reconciliación anidada', () => {
    const error = new SyncError([
      {
        stage: 'reconciliación de catálogos',
        error: new SyncError([
          {
            stage: 'estadías',
            error: new ApiError(404, 'Cannot GET /entries/ids', null),
          },
        ]),
      },
    ]);
    const translated = translateApiError(error);
    expect(translated).toContain('reconciliación de catálogos: estadías:');
    expect(translated).toContain(
      translateApiError(new ApiError(404, '', null)),
    );
    expect(translated).not.toContain('Cannot GET');
  });

  it('muestra cada etapa que falló sin perder los errores de conectividad', () => {
    const network = new TypeError('Failed to fetch');
    const unknown = new Error('private local detail');
    const translated = translateApiError(
      new SyncError([
        { stage: 'clientes', error: network },
        { stage: 'pagos', error: unknown },
      ]),
    );
    expect(translated).toBe(
      `clientes: ${translateApiError(network)} · pagos: ${translateApiError(unknown)}`,
    );
    expect(translated).not.toContain('private local detail');
  });
});
