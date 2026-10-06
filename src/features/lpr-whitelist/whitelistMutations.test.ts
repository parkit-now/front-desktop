import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LocalLprIgnoredPlate, PendingOp } from '../../lib/db/localDb';
import { ApiError } from '../../lib/api/client';
import { webcrypto } from 'node:crypto';

const h = vi.hoisted(() => {
  const rows = new Map<string, LocalLprIgnoredPlate>();
  const ops: PendingOp[] = [];
  return {
    rows,
    ops,
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    db: {
      transaction: async (_mode: unknown, ...args: unknown[]) =>
        (args.at(-1) as () => Promise<void>)(),
      lprIgnoredPlates: {
        put: (row: LocalLprIgnoredPlate) => {
          rows.set(row.id, row);
          return Promise.resolve();
        },
        delete: (id: string) => {
          rows.delete(id);
          return Promise.resolve();
        },
      },
      pendingOps: {
        where: () => ({
          equals: () => ({
            filter: (test: (row: PendingOp) => boolean) => ({
              toArray: () => Promise.resolve(ops.filter(test)),
            }),
          }),
        }),
        delete: (id: number) => {
          const index = ops.findIndex((row) => row.localId === id);
          if (index >= 0) ops.splice(index, 1);
          return Promise.resolve();
        },
        update: (id: number, changes: Partial<PendingOp>) => {
          Object.assign(ops.find((row) => row.localId === id)!, changes);
          return Promise.resolve();
        },
      },
    },
  };
});
vi.mock('../../lib/db/localDb', () => ({ localDb: h.db }));
vi.mock('../../lib/api/lpr-ignored-plates', () => ({
  createLprIgnoredPlate: h.create,
  updateLprIgnoredPlate: h.update,
  deleteLprIgnoredPlate: h.remove,
}));
vi.mock('../../lib/sync/enqueue', () => ({
  enqueuePendingOp: (op: PendingOp) => {
    h.ops.push({
      ...op,
      localId: h.ops.length + 1,
      createdAt: Date.now(),
      retryCount: 0,
      userId: 'owner',
    });
    return Promise.resolve();
  },
}));
import { mutateWhitelist } from './whitelistMutations';

const credentials = { tenantId: 'apex', bearer: 'token', isOnline: false };
const body = {
  plate: 'IAG574',
  active: true,
  notes: null,
  validFrom: null,
  validUntil: null,
};
const firstRow = () => [...h.rows.values()][0];
beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto);
  h.rows.clear();
  h.ops.length = 0;
  vi.resetAllMocks();
});

describe('escrituras local-first de Lista blanca', () => {
  it('alta offline guarda la regla inmediatamente y encola con su propietario', async () => {
    await mutateWhitelist({ ...credentials, body });
    expect(firstRow()).toMatchObject({ ...body, tenantId: 'apex', version: 1 });
    expect(h.ops[0]).toMatchObject({
      operation: 'create',
      entityType: 'lprIgnoredPlate',
      userId: 'owner',
    });
    expect(h.create).not.toHaveBeenCalled();
  });
  it('ediciones antes de sincronizar se integran al alta sin desfasar su versión', async () => {
    await mutateWhitelist({ ...credentials, body });
    await mutateWhitelist({
      ...credentials,
      row: firstRow(),
      body: { active: false },
    });
    await mutateWhitelist({
      ...credentials,
      row: firstRow(),
      body: { notes: 'Auto personal' },
    });
    expect(h.ops).toHaveLength(1);
    expect(h.ops[0].payload).toMatchObject({
      ...body,
      active: false,
      notes: 'Auto personal',
    });
    expect(firstRow().version).toBe(1);
  });
  it('eliminar un alta no sincronizada cancela la operación', async () => {
    await mutateWhitelist({ ...credentials, body });
    await mutateWhitelist({ ...credentials, row: firstRow(), remove: true });
    expect(h.rows.size).toBe(0);
    expect(h.ops).toHaveLength(0);
  });
  it('combina ediciones offline conservando la versión remota para el CAS', async () => {
    const row = {
      ...body,
      id: 'rule',
      tenantId: 'apex',
      version: 7,
      syncSeq: 4,
      deletedAt: null,
      createdAt: '2026-10-06',
      updatedAt: '2026-10-06',
    };
    h.rows.set(row.id, row);
    await mutateWhitelist({ ...credentials, row, body: { notes: 'Personal' } });
    await mutateWhitelist({
      ...credentials,
      isOnline: true,
      row: firstRow(),
      body: { active: false },
    });
    expect(firstRow().version).toBe(8);
    expect(h.ops).toHaveLength(1);
    expect(h.ops[0].payload).toEqual({
      expectedVersion: 7,
      body: { notes: 'Personal', active: false },
    });
    expect(h.update).not.toHaveBeenCalled();
  });
  it('un corte durante el guardado online deja regla y operación pendientes', async () => {
    h.create.mockRejectedValue(new TypeError('Failed to fetch'));
    await mutateWhitelist({ ...credentials, isOnline: true, body });
    expect(firstRow().plate).toBe('IAG574');
    expect(h.ops[0].operation).toBe('create');
  });
  it('errores de validación o duplicado no crean reglas locales ficticias', async () => {
    h.create.mockRejectedValue(new ApiError(409, 'Duplicate', null));
    await expect(
      mutateWhitelist({ ...credentials, isOnline: true, body }),
    ).rejects.toMatchObject({ status: 409 });
    expect(h.rows.size).toBe(0);
    expect(h.ops).toHaveLength(0);
  });
});
