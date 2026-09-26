import type {
  ColumnDef,
  ColumnFiltersState,
  SortingState,
  VisibilityState,
} from '@tanstack/react-table';
import type { ReactNode } from 'react';
import type { TableTemplateScope } from '../table-view-template';

export type DataTableFilterOption = {
  value: string;
  label: string;
};

export type DataTableFilterSwitch = {
  id: string;
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
};

export type DataTableServerState = {
  rowCount: number;
  isFetching?: boolean;
  onPaginationChange?: (state: { pageIndex: number; pageSize: number }) => void;
};

export type DataTableProps<TData> = {
  data: TData[];
  columns: ColumnDef<TData, unknown>[];
  title?: string;
  subtitle?: string;
  isLoading?: boolean;
  emptyMessage?: string;
  searchPlaceholder?: string;
  searchableKeys?: string[];
  filterableColumns?: string[];
  filterOptionsByColumn?: Record<string, DataTableFilterOption[]>;
  filterSwitches?: DataTableFilterSwitch[];
  persistState?: boolean;
  persistentSwitches?: Record<string, boolean>;
  initialColumnFiltersOverridePersistedState?: boolean;
  initialPageSize?: number;
  initialColumnFilters?: ColumnFiltersState;
  onColumnFiltersChange?: (filters: ColumnFiltersState) => void;
  columnFiltersOverride?: ColumnFiltersState;
  columnFiltersOverrideKey?: string | number;
  initialSorting?: SortingState;
  /** Columnas que existen (p. ej. para filtrar) pero arrancan ocultas. */
  initialColumnVisibility?: VisibilityState;
  pageSizeOptions?: number[];
  getRowId?: (row: TData, index: number) => string;
  onRowClick?: (row: TData) => void;
  templateScope?: TableTemplateScope;
  headerAction?: ReactNode;
  toolbarExtra?: ReactNode;
  onRefresh?: () => void;
  refreshDisabled?: boolean;
  serverState?: DataTableServerState;
};
