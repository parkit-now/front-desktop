import {
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
  type SortingFn,
  type SortingState,
  type Updater,
  useReactTable,
  type VisibilityState,
} from '@tanstack/react-table';
import { ArrowUpDown, RefreshCcw, Search, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  TemplateSelector,
  type TableViewConfig,
  type TableTemplateScope,
  readTableTemplateCollection,
  sanitizeTableViewConfig,
} from '../table-view-template';
import { ColumnPicker } from './components/ColumnPicker';
import { FilterPanel } from './components/FilterPanel';
import { Pagination } from './components/Pagination';
import type { DataTableProps } from './types';
import {
  caseInsensitiveSort,
  getPaginationPageCount,
  normalizeText,
} from './utils';

declare module '@tanstack/react-table' {
  interface FilterFns {
    includesSome: FilterFn<unknown>;
  }
}

const includesSomeFilter: FilterFn<unknown> = (row, columnId, value) => {
  if (!Array.isArray(value) || value.length === 0) return true;
  return value.map(String).includes(String(row.getValue(columnId) ?? ''));
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

export function DataTable<TData>({
  data,
  columns,
  title,
  subtitle,
  isLoading,
  emptyMessage = 'No hay resultados para mostrar.',
  searchPlaceholder = 'Buscar...',
  searchableKeys,
  filterableColumns = [],
  filterOptionsByColumn,
  initialPageSize = 10,
  pageSizeOptions = [5, 10, 20, 30, 50],
  getRowId,
  templateScope,
  headerAction,
  toolbarExtra,
  onRefresh,
  refreshDisabled,
  serverState,
}: DataTableProps<TData>) {
  const [globalFilter, setGlobalFilter] = useState('');
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [columnOrder, setColumnOrder] = useState<string[]>([]);
  const [columnPinning, setColumnPinning] = useState<{ left?: string[] }>({
    left: [],
  });
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: initialPageSize,
  });
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(
    null,
  );
  const autoAppliedScopeRef = useRef<string | null>(null);
  const currentScopeKey = scopeKey(templateScope);

  useEffect(() => {
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
      const sanitized = sanitizeTableViewConfig(config, knownColumnIds);

      if (!sanitized) {
        setGlobalFilter('');
        setColumnFilters([]);
        setSorting([]);
        setColumnVisibility({});
        setColumnOrder([]);
        setColumnPinning({ left: [] });
        setPagination({ pageIndex: 0, pageSize: initialPageSize });
        return;
      }

      setGlobalFilter(sanitized.globalSearch);
      setColumnFilters(sanitized.filters);
      setSorting(sanitized.sorting);
      setColumnVisibility(sanitized.columns.visibility);
      setColumnOrder(sanitized.columns.order);
      setColumnPinning({ left: sanitized.columns.pinnedLeft });
      setPagination({ pageIndex: 0, pageSize: sanitized.pagination.pageSize });
    },
    [initialPageSize, knownColumnIds],
  );

  useEffect(() => {
    if (!templateScope || knownColumnIds.length === 0) return;
    if (autoAppliedScopeRef.current === currentScopeKey) return;

    autoAppliedScopeRef.current = currentScopeKey;
    const collection = readTableTemplateCollection(templateScope);
    const template = collection.templates.find(
      (item) => item.id === collection.lastUsedTemplateId,
    );
    if (!template) return;

    setSelectedTemplateId(template.id);
    applyConfig(template.config);
  }, [applyConfig, currentScopeKey, knownColumnIds.length, templateScope]);

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
    columnFilters.length > 0 || globalFilter.trim().length > 0;
  const showLoading = Boolean(isLoading || serverState?.isFetching);

  useEffect(() => {
    if (safePageIndex !== pagination.pageIndex) {
      setPagination((current) => ({ ...current, pageIndex: safePageIndex }));
    }
  }, [pagination.pageIndex, safePageIndex]);

  return (
    <section className="dt-card">
      <div className="dt-card-header">
        <div>
          {title ? <h3>{title}</h3> : null}
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
        <div className="dt-card-header-right">
          {hasActiveFilters ? (
            <span className="dt-active-chip">Vista filtrada</span>
          ) : null}
          {headerAction ?? null}
        </div>
      </div>

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
                <tr key={row.id}>
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
        onPageIndexChange={(pageIndex) => table.setPageIndex(pageIndex)}
        onPageSizeChange={(pageSize) => table.setPageSize(pageSize)}
      />
    </section>
  );
}
