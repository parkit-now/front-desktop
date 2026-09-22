import {
  type ColumnDef,
  type ColumnFiltersState,
  flexRender,
  type FilterFn,
  getCoreRowModel,
  getFacetedRowModel,
  getFacetedUniqueValues,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  type PaginationState,
  type RowData,
  type SortingFn,
  type SortingState,
  type Updater,
  useReactTable,
  type VisibilityState,
} from '@tanstack/react-table';
import { format } from 'date-fns';
import { ArrowUpDown, RefreshCcw, Search, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DateRange } from '../../lib/ui/DateRangeFilter';
import {
  TemplateSelector,
  type TableFilterValueNormalizers,
  type TableViewConfig,
  type TableTemplateScope,
  readPersistedTableState,
  readTableTemplateCollection,
  sanitizeTableViewConfig,
  writePersistedTableState,
} from '../table-view-template';
import { ColumnPicker } from './components/ColumnPicker';
import { FilterPanel } from './components/FilterPanel';
import { Pagination } from './components/Pagination';
import { Switch } from '../../lib/ui/Switch';
import type { DataTableProps } from './types';
import {
  caseInsensitiveSort,
  getPaginationPageCount,
  normalizeText,
} from './utils';

declare module '@tanstack/react-table' {
  interface FilterFns {
    includesSome: FilterFn<unknown>;
    dateRange: FilterFn<unknown>;
  }

  // Los type params son obligatorios para el declaration merging, aunque este
  // campo no los use.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    filterLabel?: string;
  }
}

const includesSomeFilter: FilterFn<unknown> = (row, columnId, value) => {
  if (!Array.isArray(value) || value.length === 0) return true;
  return value.map(String).includes(String(row.getValue(columnId) ?? ''));
};

const EMPTY_FILTERABLE_COLUMNS: string[] = [];
const DEFAULT_PAGE_SIZE_OPTIONS = [5, 10, 20, 30, 50];

function toDateKey(raw: unknown): string | null {
  if (raw instanceof Date) {
    return Number.isNaN(raw.getTime()) ? null : format(raw, 'yyyy-MM-dd');
  }
  if (typeof raw === 'string' && raw.length >= 10) return raw.slice(0, 10);
  return null;
}

const dateRangeFilter: FilterFn<unknown> = (row, columnId, value) => {
  const range = value as DateRange | undefined;
  if (!range?.from) return true;
  const key = toDateKey(row.getValue(columnId));
  if (!key) return false;
  const fromKey = format(range.from, 'yyyy-MM-dd');
  const toKey = format(range.to ?? range.from, 'yyyy-MM-dd');
  return key >= fromKey && key <= toKey;
};

function makeGlobalFilter<TData>(searchableKeys?: string[]): FilterFn<TData> {
  return (row, _columnId, value) => {
    const query = normalizeText(value);
    if (!query) return true;

    const original = row.original as Record<string, unknown>;
    const keys = searchableKeys?.length
      ? searchableKeys
      : row.getAllCells().map((cell) => cell.column.id);

    return keys.some((key) => {
      const cellValue = key in original ? original[key] : row.getValue(key);
      return normalizeText(cellValue).includes(query);
    });
  };
}

function scopeKey(scope?: TableTemplateScope): string {
  if (!scope) return 'no-scope';
  return `${scope.userId}:${scope.tenantId}:${scope.tableKey}`;
}

function columnIdsFromDefinitions<TData>(
  definitions: ColumnDef<TData, unknown>[],
): string[] {
  return definitions.flatMap((column) => {
    const nested = 'columns' in column ? column.columns : undefined;
    if (Array.isArray(nested)) {
      return columnIdsFromDefinitions(nested as ColumnDef<TData, unknown>[]);
    }
    if (typeof column.id === 'string' && column.id.length > 0) {
      return [column.id];
    }
    const accessorKey = (column as { accessorKey?: unknown }).accessorKey;
    return typeof accessorKey === 'string' && accessorKey.length > 0
      ? [accessorKey]
      : [];
  });
}

function isDateRangeColumn<TData>(
  definition: ColumnDef<TData, unknown>,
): boolean {
  return String(definition.filterFn ?? '') === 'dateRange';
}

function columnFilterNormalizersFromDefinitions<TData>(
  definitions: ColumnDef<TData, unknown>[],
  filterableColumns: readonly string[],
): TableFilterValueNormalizers {
  return definitions.reduce<TableFilterValueNormalizers>(
    (normalizers, column) => {
      const nested = 'columns' in column ? column.columns : undefined;
      if (Array.isArray(nested)) {
        return {
          ...normalizers,
          ...columnFilterNormalizersFromDefinitions(
            nested as ColumnDef<TData, unknown>[],
            filterableColumns,
          ),
        };
      }

      const id =
        typeof column.id === 'string' && column.id.length > 0
          ? column.id
          : typeof (column as { accessorKey?: unknown }).accessorKey ===
              'string'
            ? String((column as { accessorKey: string }).accessorKey)
            : null;
      if (!id) return normalizers;

      if (isDateRangeColumn(column)) {
        normalizers[id] = normalizeDateRangeFilterValue;
        return normalizers;
      }

      if (filterableColumns.includes(id)) {
        normalizers[id] = normalizeOptionListFilterValue;
      }

      return normalizers;
    },
    {},
  );
}

function toValidDate(raw: unknown): Date | undefined {
  if (raw instanceof Date) {
    return Number.isNaN(raw.getTime()) ? undefined : raw;
  }
  if (typeof raw !== 'string' && typeof raw !== 'number') return undefined;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function normalizeDateRangeFilterValue(value: unknown): DateRange | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const range = value as { from?: unknown; to?: unknown };
  const from = toValidDate(range.from);
  if (!from) return undefined;
  const to = toValidDate(range.to);
  return to ? { from, to } : { from };
}

function normalizeOptionListFilterValue(value: unknown): string[] | undefined {
  const values = Array.isArray(value) ? value : [value];
  const normalized = values
    .map((item) => String(item ?? '').trim())
    .filter((item) => item.length > 0);
  return normalized.length > 0 ? normalized : undefined;
}

function applyInitialColumnFiltersOverride(
  config: TableViewConfig,
  initialColumnFilters: ColumnFiltersState | undefined,
  enabled: boolean,
): TableViewConfig {
  if (!enabled) return config;
  return {
    ...config,
    filters: initialColumnFilters ?? [],
    globalSearch: '',
  };
}

export function DataTable<TData>({
  data,
  columns,
  title,
  subtitle,
  isLoading,
  emptyMessage = 'No hay resultados para mostrar.',
  searchPlaceholder = 'Buscar...',
  searchableKeys,
  filterableColumns = EMPTY_FILTERABLE_COLUMNS,
  filterOptionsByColumn,
  filterSwitches,
  persistState = false,
  persistentSwitches,
  initialColumnFiltersOverridePersistedState = false,
  initialPageSize = 10,
  initialColumnFilters,
  onColumnFiltersChange,
  columnFiltersOverride,
  columnFiltersOverrideKey,
  initialSorting,
  pageSizeOptions = DEFAULT_PAGE_SIZE_OPTIONS,
  getRowId,
  onRowClick,
  templateScope,
  headerAction,
  toolbarExtra,
  onRefresh,
  refreshDisabled,
  serverState,
}: DataTableProps<TData>) {
  const initialKnownColumnIds = useMemo(
    () => columnIdsFromDefinitions(columns),
    [columns],
  );
  const filterNormalizers = useMemo(
    () => columnFilterNormalizersFromDefinitions(columns, filterableColumns),
    [columns, filterableColumns],
  );
  const initialPersistedState = useMemo(() => {
    if (!persistState || !templateScope) return null;
    const persisted = readPersistedTableState(
      templateScope,
      initialKnownColumnIds,
      filterNormalizers,
    );
    if (!persisted) return null;
    return {
      ...persisted,
      config: applyInitialColumnFiltersOverride(
        persisted.config,
        initialColumnFilters,
        initialColumnFiltersOverridePersistedState,
      ),
    };
  }, [
    filterNormalizers,
    initialColumnFilters,
    initialColumnFiltersOverridePersistedState,
    initialKnownColumnIds,
    persistState,
    templateScope,
  ]);
  const initialPersistedStateRef = useRef(initialPersistedState);
  const [globalFilter, setGlobalFilter] = useState(
    () => initialPersistedStateRef.current?.config.globalSearch ?? '',
  );
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>(
    () =>
      initialPersistedStateRef.current?.config.filters ??
      initialColumnFilters ??
      [],
  );
  const [sorting, setSorting] = useState<SortingState>(
    () =>
      initialPersistedStateRef.current?.config.sorting ?? initialSorting ?? [],
  );
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(
    () => initialPersistedStateRef.current?.config.columns.visibility ?? {},
  );
  const [columnOrder, setColumnOrder] = useState<string[]>(
    () => initialPersistedStateRef.current?.config.columns.order ?? [],
  );
  const [columnPinning, setColumnPinning] = useState<{ left?: string[] }>({
    left: initialPersistedStateRef.current?.config.columns.pinnedLeft ?? [],
  });
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize:
      initialPersistedStateRef.current?.config.pagination.pageSize ??
      initialPageSize,
  });
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(
    null,
  );
  const autoAppliedScopeRef = useRef<string | null>(null);
  const currentScopeKey = scopeKey(templateScope);

  useEffect(() => {
    if (initialPersistedStateRef.current) return;
    setPagination((current) =>
      current.pageSize === initialPageSize
        ? current
        : { pageIndex: 0, pageSize: initialPageSize },
    );
  }, [initialPageSize]);

  useEffect(() => {
    setPagination((current) =>
      current.pageIndex === 0 ? current : { ...current, pageIndex: 0 },
    );
  }, [columnFilters, globalFilter, sorting]);

  useEffect(() => {
    onColumnFiltersChange?.(columnFilters);
  }, [columnFilters, onColumnFiltersChange]);

  useEffect(() => {
    if (columnFiltersOverrideKey === undefined) return;
    setColumnFilters(columnFiltersOverride ?? []);
  }, [columnFiltersOverride, columnFiltersOverrideKey]);

  useEffect(() => {
    serverState?.onPaginationChange?.(pagination);
  }, [pagination, serverState]);

  const table = useReactTable({
    data,
    columns,
    state: {
      columnFilters,
      globalFilter,
      sorting,
      columnVisibility,
      columnOrder,
      columnPinning,
      pagination,
    },
    getRowId,
    onColumnFiltersChange: setColumnFilters,
    onGlobalFilterChange: (updater: Updater<string>) => {
      setGlobalFilter((current) => {
        const next = typeof updater === 'function' ? updater(current) : updater;
        return String(next ?? '');
      });
    },
    onSortingChange: setSorting,
    onColumnVisibilityChange: (updater) => {
      setColumnVisibility((current) => {
        const next = typeof updater === 'function' ? updater(current) : updater;
        const hiddenIds = Object.entries(next)
          .filter(([, isVisible]) => isVisible === false)
          .map(([columnId]) => columnId);
        if (hiddenIds.length > 0) {
          setColumnPinning((currentPinning) => ({
            ...currentPinning,
            left: (currentPinning.left ?? []).filter(
              (columnId) => !hiddenIds.includes(columnId),
            ),
          }));
        }
        return next;
      });
    },
    onColumnOrderChange: (updater) => {
      setColumnOrder((current) =>
        typeof updater === 'function' ? updater(current) : updater,
      );
    },
    onColumnPinningChange: setColumnPinning,
    onPaginationChange: setPagination,
    filterFns: {
      includesSome: includesSomeFilter,
      dateRange: dateRangeFilter,
    },
    defaultColumn: {
      filterFn: 'includesSome',
      sortingFn: caseInsensitiveSort as SortingFn<TData>,
    },
    globalFilterFn: makeGlobalFilter(searchableKeys),
    autoResetPageIndex: false,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
    ...(serverState
      ? {
          manualPagination: true,
          manualSorting: true,
          manualFiltering: true,
          rowCount: serverState.rowCount,
        }
      : {}),
  });

  const knownColumnIds = useMemo(
    () => table.getAllLeafColumns().map((column) => column.id),
    [table],
  );

  const applyConfig = useCallback(
    (config: TableViewConfig | null) => {
      const sanitized = sanitizeTableViewConfig(
        config,
        knownColumnIds,
        filterNormalizers,
      );

      if (!sanitized) {
        setGlobalFilter('');
        setColumnFilters([]);
        setSorting(initialSorting ?? []);
        setColumnVisibility({});
        setColumnOrder([]);
        setColumnPinning({ left: [] });
        setPagination({ pageIndex: 0, pageSize: initialPageSize });
        if (persistState && templateScope) {
          writePersistedTableState(templateScope, {
            version: 1,
            config: {
              version: 1,
              columns: {
                visibility: {},
                order: [],
                pinnedLeft: [],
              },
              filters: [],
              sorting: initialSorting ?? [],
              globalSearch: '',
              pagination: { pageSize: initialPageSize },
            },
            switches: persistentSwitches ?? {},
          });
        }
        return;
      }

      setGlobalFilter(sanitized.globalSearch);
      setColumnFilters(sanitized.filters);
      setSorting(sanitized.sorting);
      setColumnVisibility(sanitized.columns.visibility);
      setColumnOrder(sanitized.columns.order);
      setColumnPinning({ left: sanitized.columns.pinnedLeft });
      setPagination({ pageIndex: 0, pageSize: sanitized.pagination.pageSize });
      if (persistState && templateScope) {
        writePersistedTableState(templateScope, {
          version: 1,
          config: sanitized,
          switches: persistentSwitches ?? {},
        });
      }
    },
    [
      initialPageSize,
      initialSorting,
      filterNormalizers,
      knownColumnIds,
      persistState,
      persistentSwitches,
      templateScope,
    ],
  );

  useEffect(() => {
    if (!templateScope || knownColumnIds.length === 0) return;
    if (autoAppliedScopeRef.current === currentScopeKey) return;

    autoAppliedScopeRef.current = currentScopeKey;
    if (persistState) {
      const persisted = readPersistedTableState(
        templateScope,
        knownColumnIds,
        filterNormalizers,
      );
      if (persisted) {
        setSelectedTemplateId(null);
        applyConfig(
          applyInitialColumnFiltersOverride(
            persisted.config,
            initialColumnFilters,
            initialColumnFiltersOverridePersistedState,
          ),
        );
        return;
      }
    }

    const collection = readTableTemplateCollection(templateScope);
    const template = collection.templates.find(
      (item) => item.id === collection.lastUsedTemplateId,
    );
    if (!template) {
      setSelectedTemplateId(null);
      applyConfig(null);
      return;
    }

    setSelectedTemplateId(template.id);
    applyConfig(
      applyInitialColumnFiltersOverride(
        template.config,
        initialColumnFilters,
        initialColumnFiltersOverridePersistedState,
      ),
    );
  }, [
    applyConfig,
    currentScopeKey,
    filterNormalizers,
    initialColumnFilters,
    initialColumnFiltersOverridePersistedState,
    knownColumnIds,
    knownColumnIds.length,
    persistState,
    templateScope,
  ]);

  const currentConfig = useCallback((): TableViewConfig => {
    return {
      version: 1,
      columns: {
        visibility: columnVisibility,
        order: columnOrder,
        pinnedLeft: columnPinning.left ?? [],
      },
      filters: columnFilters.map((filter) => ({
        id: filter.id,
        value: filter.value,
      })),
      sorting,
      globalSearch: globalFilter,
      pagination: { pageSize: pagination.pageSize },
    };
  }, [
    columnFilters,
    columnOrder,
    columnPinning.left,
    columnVisibility,
    globalFilter,
    pagination.pageSize,
    sorting,
  ]);

  const totalRows =
    serverState?.rowCount ?? table.getFilteredRowModel().rows.length;
  const pageCount = getPaginationPageCount(totalRows, pagination.pageSize);
  const safePageIndex = Math.min(
    pagination.pageIndex,
    Math.max(0, pageCount - 1),
  );
  const rows = table.getRowModel().rows;
  const visibleColumns = table.getVisibleLeafColumns();
  const hasActiveFilters =
    columnFilters.length > 0 ||
    globalFilter.trim().length > 0 ||
    Boolean(filterSwitches?.some((item) => item.checked));
  const hasHeaderContent = Boolean(title || subtitle || headerAction);
  const showLoading = Boolean(isLoading || serverState?.isFetching);

  useEffect(() => {
    if (!persistState || !templateScope || knownColumnIds.length === 0) return;

    const timeout = window.setTimeout(() => {
      writePersistedTableState(templateScope, {
        version: 1,
        config: currentConfig(),
        switches: persistentSwitches ?? {},
      });
    }, 300);

    return () => window.clearTimeout(timeout);
  }, [
    currentConfig,
    knownColumnIds.length,
    persistState,
    persistentSwitches,
    templateScope,
  ]);

  useEffect(() => {
    if (safePageIndex !== pagination.pageIndex) {
      setPagination((current) => ({ ...current, pageIndex: safePageIndex }));
    }
  }, [pagination.pageIndex, safePageIndex]);

  return (
    <section className="dt-card">
      {hasHeaderContent ? (
        <div className="dt-card-header">
          <div>
            {title ? <h3>{title}</h3> : null}
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          <div className="dt-card-header-right">{headerAction ?? null}</div>
        </div>
      ) : null}

      <div className="dt-toolbar">
        <div className="dt-search-cluster">
          <label className="dt-search">
            <Search size={17} />
            <input
              type="search"
              value={globalFilter}
              onChange={(event) => table.setGlobalFilter(event.target.value)}
              placeholder={searchPlaceholder}
            />
            {globalFilter ? (
              <button
                type="button"
                className="dt-search-clear"
                onClick={() => table.setGlobalFilter('')}
                title="Limpiar búsqueda"
              >
                <X size={15} />
              </button>
            ) : null}
          </label>
          {onRefresh ? (
            <button
              type="button"
              className="dt-search-side-button"
              onClick={onRefresh}
              disabled={refreshDisabled || showLoading}
              title="Recargar datos"
            >
              <RefreshCcw size={17} />
            </button>
          ) : null}
        </div>

        {filterSwitches && filterSwitches.length > 0 ? (
          <div className="dt-toolbar-switches">
            {filterSwitches.map((item) => (
              <Switch
                key={item.id}
                checked={item.checked}
                disabled={item.disabled}
                onChange={item.onChange}
                label={item.label}
              />
            ))}
          </div>
        ) : null}

        <div className="dt-toolbar-actions">
          <FilterPanel
            table={table}
            filterableColumns={filterableColumns}
            filterOptionsByColumn={filterOptionsByColumn}
          />
          {toolbarExtra}
          <TemplateSelector
            scope={templateScope}
            selectedTemplateId={selectedTemplateId}
            onSelectedTemplateIdChange={setSelectedTemplateId}
            getCurrentConfig={currentConfig}
            onApply={applyConfig}
          />
          <ColumnPicker
            table={table}
            columnOrder={columnOrder}
            onResetColumns={() => {
              setColumnVisibility({});
              setColumnOrder([]);
              setColumnPinning({ left: [] });
            }}
          />
        </div>
      </div>

      <div className="dt-scroll-shell">
        <table className="dt-table">
          <thead>
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  const column = header.column;
                  const pinned = column.getIsPinned();
                  return (
                    <th
                      key={header.id}
                      className={pinned === 'left' ? 'pinned-left' : undefined}
                      style={
                        pinned === 'left'
                          ? {
                              left: column.getStart('left'),
                              width: column.getSize(),
                            }
                          : { width: column.getSize() }
                      }
                    >
                      {header.isPlaceholder ? null : column.getCanSort() ? (
                        <button
                          type="button"
                          className="dt-sort-button"
                          onClick={column.getToggleSortingHandler()}
                        >
                          {flexRender(
                            header.column.columnDef.header,
                            header.getContext(),
                          )}
                          <ArrowUpDown size={14} />
                        </button>
                      ) : (
                        flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {showLoading ? (
              <tr>
                <td colSpan={visibleColumns.length || 1}>
                  <div className="dt-state">Cargando datos...</div>
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={visibleColumns.length || 1}>
                  <div className="dt-state empty">{emptyMessage}</div>
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr
                  key={row.id}
                  className={onRowClick ? 'dt-row-clickable' : undefined}
                  onClick={
                    onRowClick ? () => onRowClick(row.original) : undefined
                  }
                >
                  {row.getVisibleCells().map((cell) => {
                    const pinned = cell.column.getIsPinned();
                    return (
                      <td
                        key={cell.id}
                        className={
                          pinned === 'left' ? 'pinned-left' : undefined
                        }
                        style={
                          pinned === 'left'
                            ? {
                                left: cell.column.getStart('left'),
                                width: cell.column.getSize(),
                              }
                            : { width: cell.column.getSize() }
                        }
                      >
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext(),
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Pagination
        pageIndex={safePageIndex}
        pageSize={pagination.pageSize}
        pageCount={pageCount}
        totalRows={totalRows}
        pageSizeOptions={pageSizeOptions}
        canPreviousPage={safePageIndex > 0}
        canNextPage={safePageIndex + 1 < pageCount}
        status={
          hasActiveFilters ? (
            <span className="dt-active-chip">Vista filtrada</span>
          ) : null
        }
        onPageIndexChange={(pageIndex) => table.setPageIndex(pageIndex)}
        onPageSizeChange={(pageSize) => table.setPageSize(pageSize)}
      />
    </section>
  );
}
