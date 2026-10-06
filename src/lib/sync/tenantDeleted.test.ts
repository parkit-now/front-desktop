import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/client';
import {
  isTenantDeletedError,
  notifyTenantDeleted,
  onTenantDeleted,
  setPendingAuthNotice,
  takePendingAuthNotice,
  tenantIdFromPath,
  TENANT_DELETED_NOTICE,
} from './tenantDeleted';

function apiError(status: number, code?: string): ApiError {
  return new ApiError(status, 'boom', code ? ({ code } as never) : null);
}

describe('isTenantDeletedError', () => {
  it('reconoce el 410 con el code del backend', () => {
    expect(isTenantDeletedError(apiError(410, 'ENTITY_DELETED'))).toBe(true);
  });

  it('no alcanza con el 410 pelado', () => {
    // El `code` es el contrato estable. Si mañana 410 se usa para otra cosa,
    // mirar sólo el status cerraría sesiones por el motivo equivocado.
    expect(isTenantDeletedError(apiError(410))).toBe(false);
    expect(isTenantDeletedError(apiError(410, 'OTRA_COSA'))).toBe(false);
  });

  it('no confunde un 403 ni un 404 con una baja', () => {
    expect(isTenantDeletedError(apiError(403, 'ENTITY_NO_ACCESS'))).toBe(false);
    expect(isTenantDeletedError(apiError(404, 'ENTITY_NOT_FOUND'))).toBe(false);
  });

  it('un corte de red no es una baja', () => {
    // Es la distinción que sostiene todo el modo offline: sin esto, perder
    // internet cerraría la sesión del operador.
    expect(isTenantDeletedError(new TypeError('Failed to fetch'))).toBe(false);
    expect(isTenantDeletedError(null)).toBe(false);
    expect(isTenantDeletedError(undefined)).toBe(false);
  });
});

describe('tenantIdFromPath', () => {
  it.each([
    ['/tenants/t-1/entries/changes?afterSeq=4', 't-1'],
    ['/tenants/t-1', 't-1'],
    ['/tenants/t-1?x=1', 't-1'],
  ])('%s → %s', (path, expected) => {
    expect(tenantIdFromPath(path)).toBe(expected);
  });

  it.each(['/health', '/auth/me', '/admin/parkings/t-1', ''])(
    'devuelve null para %s',
    (path) => {
      expect(tenantIdFromPath(path)).toBeNull();
    },
  );
});

describe('onTenantDeleted', () => {
  it('avisa a los suscriptos con el tenant', () => {
    const seen: string[] = [];
    const off = onTenantDeleted((id) => seen.push(id));
    notifyTenantDeleted('t-1');
    expect(seen).toEqual(['t-1']);
    off();
  });

  it('deja de avisar después de desuscribirse', () => {
    const seen: string[] = [];
    const off = onTenantDeleted((id) => seen.push(id));
    off();
    notifyTenantDeleted('t-1');
    expect(seen).toEqual([]);
  });

  it('un listener que explota no deja sin avisar a los demás', () => {
    // El que cierra la sesión no puede quedar colgado porque otro falló.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const seen: string[] = [];
    const offBad = onTenantDeleted(() => {
      throw new Error('roto');
    });
    const offGood = onTenantDeleted((id) => seen.push(id));

    notifyTenantDeleted('t-1');

    expect(seen).toEqual(['t-1']);
    offBad();
    offGood();
    spy.mockRestore();
  });
});

describe('aviso pendiente para la pantalla de login', () => {
  beforeEach(() => {
    takePendingAuthNotice();
  });

  it('se consume al leerlo', () => {
    // Si quedara, aparecería en el próximo logout manual, que no tiene nada
    // que ver con esto.
    setPendingAuthNotice(TENANT_DELETED_NOTICE);
    expect(takePendingAuthNotice()).toBe(TENANT_DELETED_NOTICE);
    expect(takePendingAuthNotice()).toBeNull();
  });

  it('sin nada pendiente devuelve null', () => {
    expect(takePendingAuthNotice()).toBeNull();
  });
});
