import { describe, expect, it } from 'vitest';
import type { TableTemplateScope, TableViewConfig } from './definitions';
import {
  buildTableStateStorageKey,
  buildTableTemplateStorageKey,
  deleteTableTemplate,
  readPersistedTableState,
  readPersistedTableSwitches,
  readTableTemplateCollection,
  sanitizeTableViewConfig,
  saveTableTemplate,
  setLastUsedTableTemplate,
  updateTableTemplateMetadata,
  writePersistedTableState,
} from './storage';

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

class FailingWriteStorage extends MemoryStorage {
  override setItem(): void {
    throw new Error('quota exceeded');
  }
}

const scope: TableTemplateScope = {
  userId: 'user-1',
  tenantId: 'tenant-1',
  tableKey: 'rates',
};

const config: TableViewConfig = {
  version: 1,
  columns: {
    visibility: { name: true, status: true, legacy: false },
    order: ['status', 'legacy', 'name'],
    pinnedLeft: ['legacy', 'name'],
  },
  filters: [
    { id: 'status', value: ['Activa'] },
    { id: 'legacy', value: ['x'] },
  ],
  sorting: [
    { id: 'legacy', desc: true },
    { id: 'name', desc: false },
  ],
  globalSearch: 'dia',
  pagination: { pageSize: 20 },
};

describe('table view template storage', () => {
  it('builds scoped storage keys', () => {
    expect(buildTableTemplateStorageKey(scope)).toBe(
      'parkit.desktop.table-views:user-1:tenant-1:rates',
    );
    expect(buildTableStateStorageKey(scope)).toBe(
      'parkit.desktop.table-state:user-1:tenant-1:rates',
    );
  });

  it('saves templates and remembers the last used template', () => {
    const storage = new MemoryStorage();
    const template = saveTableTemplate(
      scope,
      { name: 'Diaria', config },
      storage,
    );

    expect(template?.name).toBe('Diaria');
    const collection = readTableTemplateCollection(scope, storage);
    expect(collection.templates).toHaveLength(1);
    expect(collection.lastUsedTemplateId).toBe(template?.id);
  });

  it('updates and clears last used templates', () => {
    const storage = new MemoryStorage();
    const template = saveTableTemplate(
      scope,
      { name: 'Diaria', config },
      storage,
    );
    expect(template).not.toBeNull();

    setLastUsedTableTemplate(scope, null, storage);
    expect(
      readTableTemplateCollection(scope, storage).lastUsedTemplateId,
    ).toBeNull();

    deleteTableTemplate(scope, template?.id ?? '', storage);
    expect(readTableTemplateCollection(scope, storage).templates).toHaveLength(
      0,
    );
  });

  it('updates template metadata without changing its config', () => {
    const storage = new MemoryStorage();
    const template = saveTableTemplate(
      scope,
      { name: 'Diaria', description: 'Vieja', config },
      storage,
    );
    expect(template).not.toBeNull();

    const updated = updateTableTemplateMetadata(
      scope,
      template?.id ?? '',
      { name: 'Diaria actualizada', description: 'Nueva' },
      storage,
    );

    expect(updated?.name).toBe('Diaria actualizada');
    expect(updated?.description).toBe('Nueva');
    expect(updated?.config).toEqual(config);
  });

  it('sanitizes configs against known columns', () => {
    expect(sanitizeTableViewConfig(config, ['name', 'status'])).toEqual({
      version: 1,
      columns: {
        visibility: { name: true, status: true },
        order: ['status', 'name'],
        pinnedLeft: ['name'],
      },
      filters: [{ id: 'status', value: ['Activa'] }],
      sorting: [{ id: 'name', desc: false }],
      globalSearch: 'dia',
      pagination: { pageSize: 20 },
    });
  });

  it('persists the last table state separately from named templates', () => {
    const storage = new MemoryStorage();
    writePersistedTableState(
      scope,
      {
        version: 1,
        config,
        switches: {
          onlyCurrentSession: true,
          includeInLot: false,
        },
      },
      storage,
    );

    expect(readTableTemplateCollection(scope, storage).templates).toHaveLength(
      0,
    );
    expect(readPersistedTableSwitches(scope, storage)).toEqual({
      onlyCurrentSession: true,
      includeInLot: false,
    });
    expect(
      readPersistedTableState(scope, ['name', 'status'], {}, storage),
    ).toEqual({
      version: 1,
      switches: {
        onlyCurrentSession: true,
        includeInLot: false,
      },
      config: {
        version: 1,
        columns: {
          visibility: { name: true, status: true },
          order: ['status', 'name'],
          pinnedLeft: ['name'],
        },
        filters: [{ id: 'status', value: ['Activa'] }],
        sorting: [{ id: 'name', desc: false }],
        globalSearch: 'dia',
        pagination: { pageSize: 20 },
      },
    });
  });

  it('ignores corrupted persisted table state', () => {
    const storage = new MemoryStorage();
    storage.setItem(buildTableStateStorageKey(scope), '{not-json');

    expect(readPersistedTableState(scope, ['name'], {}, storage)).toBeNull();
    expect(readPersistedTableSwitches(scope, storage)).toEqual({});
  });

  it('normalizes legacy filter values while sanitizing table state', () => {
    const storage = new MemoryStorage();
    writePersistedTableState(
      scope,
      {
        version: 1,
        config: {
          ...config,
          filters: [
            { id: 'status', value: 'Activa' },
            {
              id: 'createdAt',
              value: {
                from: '2026-09-10T00:00:00.000Z',
                to: '2026-09-11T00:00:00.000Z',
              },
            },
            { id: 'name', value: '' },
          ],
        },
        switches: {},
      },
      storage,
    );

    const state = readPersistedTableState(
      scope,
      ['status', 'createdAt', 'name'],
      {
        status: (value) => (typeof value === 'string' ? [value] : value),
        createdAt: (value) => {
          if (!value || typeof value !== 'object' || Array.isArray(value)) {
            return undefined;
          }
          const range = value as { from?: string; to?: string };
          return {
            from: new Date(range.from ?? ''),
            to: new Date(range.to ?? ''),
          };
        },
        name: (value) => (value ? value : undefined),
      },
      storage,
    );

    expect(state?.config.filters).toEqual([
      { id: 'status', value: ['Activa'] },
      {
        id: 'createdAt',
        value: {
          from: new Date('2026-09-10T00:00:00.000Z'),
          to: new Date('2026-09-11T00:00:00.000Z'),
        },
      },
    ]);
  });

  it('does not throw when table state cannot be written', () => {
    const storage = new FailingWriteStorage();

    expect(() =>
      writePersistedTableState(
        scope,
        {
          version: 1,
          config,
          switches: {},
        },
        storage,
      ),
    ).not.toThrow();
  });
});
