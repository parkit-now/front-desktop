import { beforeEach, describe, expect, it, vi } from 'vitest';
import { saveEntryInlineField } from './entryInlineFields';

const h = vi.hoisted(() => {
  type Entry = {
    id: string;
    tenantId: string;
    notes?: string;
    cochera?: string;
    manualInvoiceNumber?: string;
    version: number;
    syncSeq: number;
    updatedAt: string;
    deletedAt?: string;
  };
  const entries = new Map<string, Entry>();
  const update = vi.fn((id: string, patch: Partial<Entry>) => {
    const entry = entries.get(id);
    if (entry) Object.assign(entry, patch);
    return Promise.resolve();
  });
  return {
    entries,
    update,
    correct: vi.fn(),
    enqueue: vi.fn(
      (_op: {
        payload: {
          body: {
            notes?: string;
            cochera?: string;
            manualInvoiceNumber?: string;
          };
        };
      }) => {
        void _op;
        return Promise.resolve();
      },
    ),
    transaction: vi.fn(
      (
        _mode: string,
        _entries: unknown,
        _pendingOps: unknown,
        callback: () => Promise<unknown>,
      ) => callback(),
    ),
  };
});

vi.mock('../../lib/api/entries', () => ({ correctEntry: h.correct }));
vi.mock('../../lib/sync/enqueue', () => ({ enqueuePendingOp: h.enqueue }));
vi.mock('../../lib/db/localDb', () => ({
  localDb: {
    entries: {
      get: (id: string) => Promise.resolve(h.entries.get(id)),
      update: h.update,
    },
    pendingOps: {},
    transaction: h.transaction,
  },
}));

const input = {
  tenantId: 'tenant-1',
  entryId: 'entry-1',
  accessToken: 'token',
  isOnline: true,
  field: 'notes' as const,
  value: 'Nota nueva',
};

beforeEach(() => {
  h.entries.clear();
  h.entries.set('entry-1', {
    id: 'entry-1',
    tenantId: 'tenant-1',
    notes: 'Nota anterior',
    cochera: 'A1',
    version: 2,
    syncSeq: 10,
    updatedAt: '2026-10-07T10:00:00.000Z',
  });
  h.update.mockClear();
  h.correct.mockReset();
  h.enqueue.mockReset();
  h.transaction.mockClear();
});

describe('saveEntryInlineField', () => {
  it('corrige solo la nota online y refleja la versión del servidor en Dexie', async () => {
    h.correct.mockResolvedValue({
      notes: 'Nota nueva',
      version: 3,
      syncSeq: 11,
      updatedAt: '2026-10-07T10:01:00.000Z',
    });

    expect(await saveEntryInlineField(input)).toBe(true);
    expect(h.correct).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      entryId: 'entry-1',
      expectedVersion: 2,
      bearer: 'token',
      body: { notes: 'Nota nueva' },
    });
    expect(h.entries.get('entry-1')).toMatchObject({
      notes: 'Nota nueva',
      version: 3,
      syncSeq: 11,
    });
    expect(h.enqueue).not.toHaveBeenCalled();
  });

  it('actualiza Dexie y encola la corrección offline en la misma transacción', async () => {
    expect(await saveEntryInlineField({ ...input, isOnline: false })).toBe(
      true,
    );
    expect(h.transaction).toHaveBeenCalledOnce();
    expect(h.entries.get('entry-1')).toMatchObject({
      notes: 'Nota nueva',
      version: 3,
      syncSeq: 10,
    });
    expect(h.enqueue).toHaveBeenCalledWith({
      entityType: 'entry',
      operation: 'update',
      tenantId: 'tenant-1',
      entityId: 'entry-1',
      payload: {
        kind: 'correction',
        expectedVersion: 2,
        body: { notes: 'Nota nueva' },
      },
      status: 'pending',
    });
    expect(h.correct).not.toHaveBeenCalled();
  });

  it('permite borrar la nota y no encola cambios repetidos', async () => {
    expect(
      await saveEntryInlineField({ ...input, isOnline: false, value: '   ' }),
    ).toBe(true);
    expect(h.entries.get('entry-1')?.notes).toBeUndefined();
    expect(h.enqueue.mock.calls[0]?.[0]?.payload.body.notes).toBe('');
    expect(
      await saveEntryInlineField({ ...input, isOnline: false, value: '' }),
    ).toBe(false);
    expect(h.enqueue).toHaveBeenCalledOnce();
  });

  it('corrige solo la cochera online', async () => {
    h.correct.mockResolvedValue({
      cochera: 'B2',
      version: 3,
      syncSeq: 11,
      updatedAt: '2026-10-07T10:01:00.000Z',
    });

    expect(
      await saveEntryInlineField({
        ...input,
        field: 'cochera',
        value: '  B2  ',
      }),
    ).toBe(true);
    expect(h.correct).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      entryId: 'entry-1',
      expectedVersion: 2,
      bearer: 'token',
      body: { cochera: 'B2' },
    });
    expect(h.entries.get('entry-1')).toMatchObject({
      notes: 'Nota anterior',
      cochera: 'B2',
      version: 3,
      syncSeq: 11,
    });
  });

  it('encola la cochera offline y permite dejarla vacía', async () => {
    expect(
      await saveEntryInlineField({
        ...input,
        isOnline: false,
        field: 'cochera',
        value: '',
      }),
    ).toBe(true);
    expect(h.entries.get('entry-1')?.cochera).toBeUndefined();
    expect(h.enqueue.mock.calls[0]?.[0]?.payload).toEqual({
      kind: 'correction',
      expectedVersion: 2,
      body: { cochera: '' },
    });
  });

  it('guarda el número de factura manual online', async () => {
    h.correct.mockResolvedValue({
      manualInvoiceNumber: '0001-00000042',
      version: 3,
      syncSeq: 11,
      updatedAt: '2026-10-07T10:01:00.000Z',
    });
    await saveEntryInlineField({
      ...input,
      field: 'manualInvoiceNumber',
      value: ' 0001-00000042 ',
    });
    expect(h.correct).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedVersion: 2,
        body: { manualInvoiceNumber: '0001-00000042' },
      }),
    );
    expect(h.entries.get('entry-1')?.manualInvoiceNumber).toBe('0001-00000042');
  });

  it('encola el número de factura offline y permite borrarlo', async () => {
    h.entries.get('entry-1')!.manualInvoiceNumber = '42';
    await saveEntryInlineField({
      ...input,
      isOnline: false,
      field: 'manualInvoiceNumber',
      value: '',
    });
    expect(h.entries.get('entry-1')?.manualInvoiceNumber).toBeUndefined();
    expect(h.enqueue.mock.calls[0]?.[0]?.payload.body).toEqual({
      manualInvoiceNumber: '',
    });
  });

  it('no modifica un ingreso de otro estacionamiento ni uno eliminado', async () => {
    await expect(
      saveEntryInlineField({ ...input, tenantId: 'tenant-2' }),
    ).rejects.toThrow();
    h.entries.get('entry-1')!.deletedAt = '2026-10-07T11:00:00.000Z';
    await expect(saveEntryInlineField(input)).rejects.toThrow();
    expect(h.correct).not.toHaveBeenCalled();
    expect(h.update).not.toHaveBeenCalled();
  });
});
