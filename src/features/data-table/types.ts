import type {
  ColumnDef,
  ColumnFiltersState,
  SortingState,
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
  initialPageSize?: number;
  initialColumnFilters?: ColumnFiltersState;
  initialSorting?: SortingState;
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
