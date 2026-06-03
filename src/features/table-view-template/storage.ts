import {
  type SaveTableTemplateInput,
  type TableTemplateScope,
  type TableViewConfig,
  TableViewConfigSchema,
  type TableViewTemplate,
  type TableViewTemplateCollection,
  TableViewTemplateCollectionSchema,
} from './definitions';

export type TableTemplateStorage = Pick<
  Storage,
  'getItem' | 'setItem' | 'removeItem'
>;

const STORAGE_PREFIX = 'parkit.desktop.table-views';

function getBrowserStorage(): TableTemplateStorage | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage;
}

function encodeScopePart(value: string): string {
  return encodeURIComponent(value.trim());
}

export function buildTableTemplateStorageKey(
  scope: TableTemplateScope,
): string {
  return [
    STORAGE_PREFIX,
    encodeScopePart(scope.userId),
    encodeScopePart(scope.tenantId),
    encodeScopePart(scope.tableKey),
  ].join(':');
}

function emptyCollection(): TableViewTemplateCollection {
  return {
    version: 1,
    templates: [],
    lastUsedTemplateId: null,
  };
}

function safeParseCollection(raw: string | null): TableViewTemplateCollection {
  if (!raw) return emptyCollection();

  try {
    const parsed: unknown = JSON.parse(raw);
    const result = TableViewTemplateCollectionSchema.safeParse(parsed);
    if (!result.success) return emptyCollection();
    return result.data;
  } catch {
    return emptyCollection();
  }
}

function writeCollection(
  scope: TableTemplateScope,
  collection: TableViewTemplateCollection,
  storage: TableTemplateStorage | null = getBrowserStorage(),
): void {
  if (!storage) return;
  storage.setItem(
    buildTableTemplateStorageKey(scope),
    JSON.stringify(collection),
  );
}

export function readTableTemplateCollection(
  scope: TableTemplateScope,
  storage: TableTemplateStorage | null = getBrowserStorage(),
): TableViewTemplateCollection {
  if (!storage) return emptyCollection();
  return safeParseCollection(
    storage.getItem(buildTableTemplateStorageKey(scope)),
  );
}

export function readTableTemplates(
  scope: TableTemplateScope,
  storage: TableTemplateStorage | null = getBrowserStorage(),
): TableViewTemplate[] {
  return readTableTemplateCollection(scope, storage).templates;
}

function createId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `template-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeTemplateInput(
  input: SaveTableTemplateInput,
): SaveTableTemplateInput {
  return {
    ...input,
    name: input.name.trim(),
    description: input.description?.trim() || undefined,
    config: TableViewConfigSchema.parse(input.config),
  };
}

export function saveTableTemplate(
  scope: TableTemplateScope,
  input: SaveTableTemplateInput,
  storage: TableTemplateStorage | null = getBrowserStorage(),
): TableViewTemplate | null {
  if (!storage) return null;

  const normalized = normalizeTemplateInput(input);
  if (!normalized.name) return null;

  const now = new Date().toISOString();
  const collection = readTableTemplateCollection(scope, storage);
  const template: TableViewTemplate = {
    id: createId(),
    name: normalized.name,
    description: normalized.description,
    createdAt: now,
    updatedAt: now,
    config: normalized.config,
  };

  writeCollection(
    scope,
    {
      ...collection,
      templates: [...collection.templates, template],
      lastUsedTemplateId: template.id,
    },
    storage,
  );

  return template;
}

export function overwriteTableTemplate(
  scope: TableTemplateScope,
  templateId: string,
  config: TableViewConfig,
  storage: TableTemplateStorage | null = getBrowserStorage(),
): TableViewTemplate | null {
  if (!storage) return null;

  const collection = readTableTemplateCollection(scope, storage);
  const parsedConfig = TableViewConfigSchema.parse(config);
  let updatedTemplate: TableViewTemplate | null = null;
  const templates = collection.templates.map((template) => {
    if (template.id !== templateId) return template;
    updatedTemplate = {
      ...template,
      config: parsedConfig,
      updatedAt: new Date().toISOString(),
    };
    return updatedTemplate;
  });

  if (!updatedTemplate) return null;

  writeCollection(
    scope,
    {
      ...collection,
      templates,
      lastUsedTemplateId: templateId,
    },
    storage,
  );

  return updatedTemplate;
}

export function updateTableTemplateMetadata(
  scope: TableTemplateScope,
  templateId: string,
  input: { name: string; description?: string },
  storage: TableTemplateStorage | null = getBrowserStorage(),
): TableViewTemplate | null {
  if (!storage) return null;

  const name = input.name.trim();
  if (!name) return null;

  const collection = readTableTemplateCollection(scope, storage);
  let updatedTemplate: TableViewTemplate | null = null;
  const templates = collection.templates.map((template) => {
    if (template.id !== templateId) return template;
    updatedTemplate = {
      ...template,
      name,
      description: input.description?.trim() || undefined,
      updatedAt: new Date().toISOString(),
    };
    return updatedTemplate;
  });

  if (!updatedTemplate) return null;

  writeCollection(
    scope,
    {
      ...collection,
      templates,
    },
    storage,
  );

  return updatedTemplate;
}

export function deleteTableTemplate(
  scope: TableTemplateScope,
  templateId: string,
  storage: TableTemplateStorage | null = getBrowserStorage(),
): void {
  if (!storage) return;

  const collection = readTableTemplateCollection(scope, storage);
  const templates = collection.templates.filter(
    (template) => template.id !== templateId,
  );
  const lastUsedTemplateId =
    collection.lastUsedTemplateId === templateId
      ? null
      : collection.lastUsedTemplateId;

  if (templates.length === 0 && lastUsedTemplateId === null) {
    storage.removeItem(buildTableTemplateStorageKey(scope));
    return;
  }

  writeCollection(
    scope,
    {
      ...collection,
      templates,
      lastUsedTemplateId,
    },
    storage,
  );
}

export function setLastUsedTableTemplate(
  scope: TableTemplateScope,
  templateId: string | null,
  storage: TableTemplateStorage | null = getBrowserStorage(),
): void {
  if (!storage) return;
  const collection = readTableTemplateCollection(scope, storage);
  writeCollection(
    scope,
    {
      ...collection,
      lastUsedTemplateId: templateId,
    },
    storage,
  );
}

export function sanitizeTableViewConfig(
  config: TableViewConfig | null,
  knownColumnIds: readonly string[],
): TableViewConfig | null {
  if (!config) return null;

  const known = new Set(knownColumnIds);
  const parsed = TableViewConfigSchema.parse(config);
  const visibility = Object.fromEntries(
    Object.entries(parsed.columns.visibility).filter(([columnId]) =>
      known.has(columnId),
    ),
  );
  const order = parsed.columns.order.filter((columnId) => known.has(columnId));
  const pinnedLeft = parsed.columns.pinnedLeft.filter((columnId) =>
    known.has(columnId),
  );
  const filters = parsed.filters.filter((filter) => known.has(filter.id));
  const sorting = parsed.sorting.filter((sort) => known.has(sort.id));

  return {
    version: 1,
    columns: {
      visibility,
      order,
      pinnedLeft,
    },
    filters,
    sorting,
    globalSearch: parsed.globalSearch,
    pagination: parsed.pagination,
  };
}
