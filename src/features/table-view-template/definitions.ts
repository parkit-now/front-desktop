import { z } from 'zod';

export const TableColumnStateSchema = z.object({
  visibility: z.record(z.string(), z.boolean()).default({}),
  order: z.array(z.string()).default([]),
  pinnedLeft: z.array(z.string()).default([]),
});

export const TableFilterStateSchema = z.object({
  id: z.string(),
  value: z.unknown(),
});

export const TableSortingStateSchema = z.object({
  id: z.string(),
  desc: z.boolean(),
});

export const TableViewConfigSchema = z.object({
  version: z.literal(1).default(1),
  columns: TableColumnStateSchema.default({
    visibility: {},
    order: [],
    pinnedLeft: [],
  }),
  filters: z.array(TableFilterStateSchema).default([]),
  sorting: z.array(TableSortingStateSchema).default([]),
  globalSearch: z.string().default(''),
  pagination: z
    .object({
      pageSize: z.number().int().min(1).max(500).default(10),
    })
    .default({ pageSize: 10 }),
});

export const TableViewTemplateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  config: TableViewConfigSchema,
});

export const TableViewTemplateCollectionSchema = z.object({
  version: z.literal(1).default(1),
  templates: z.array(TableViewTemplateSchema).default([]),
  lastUsedTemplateId: z.string().nullable().default(null),
});

export type TableViewConfig = z.infer<typeof TableViewConfigSchema>;
export type TableViewTemplate = z.infer<typeof TableViewTemplateSchema>;
export type TableViewTemplateCollection = z.infer<
  typeof TableViewTemplateCollectionSchema
>;

export type TableTemplateScope = {
  userId: string;
  tenantId: string;
  tableKey: string;
};

export type SaveTableTemplateInput = {
  name: string;
  description?: string;
  config: TableViewConfig;
};
