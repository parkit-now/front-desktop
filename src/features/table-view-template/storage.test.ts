import { describe, expect, it } from 'vitest';
import type { TableTemplateScope, TableViewConfig } from './definitions';
import {
  buildTableTemplateStorageKey,
  deleteTableTemplate,
  readTableTemplateCollection,
  sanitizeTableViewConfig,
  saveTableTemplate,
  setLastUsedTableTemplate,
  updateTableTemplateMetadata,
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
});
