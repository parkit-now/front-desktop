import type { Column, Table } from '@tanstack/react-table';
import {
  CalendarDays,
  ChevronDown,
  RotateCcw,
  Search,
  SlidersHorizontal,
} from 'lucide-react';
import {
  type CSSProperties,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  DateRangeFilter,
  type DateRange,
} from '../../../lib/ui/DateRangeFilter';
import { Switch } from '../../../lib/ui/Switch';
import { useCloseOnOutsideClick } from '../../../lib/ui/useCloseOnOutsideClick';
import type { DataTableFilterOption, DataTableFilterSwitch } from '../types';
import { normalizeText } from '../utils';

type FilterPanelProps<TData> = {
  table: Table<TData>;
  filterableColumns: string[];
  filterOptionsByColumn?: Record<string, DataTableFilterOption[]>;
  filterSwitches?: DataTableFilterSwitch[];
};

function resolveColumnLabel<TData>(column: Column<TData, unknown>): string {
  const header = column.columnDef.header;
  return typeof header === 'string' && header.trim().length > 0
    ? header
    : column.id;
}

function selectedValues(column: Column<unknown, unknown>): string[] {
  const value = column.getFilterValue();
  return Array.isArray(value) ? value.map(String) : [];
}

function dateRangeValue(
  column: Column<unknown, unknown>,
): DateRange | undefined {
  const value = column.getFilterValue();
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as DateRange)
    : undefined;
}

function getOptions<TData>(
  column: Column<TData, unknown>,
  filterOptionsByColumn?: Record<string, DataTableFilterOption[]>,
): DataTableFilterOption[] {
  const predefined = filterOptionsByColumn?.[column.id];
  if (predefined) return predefined;

  const values = Array.from(column.getFacetedUniqueValues().keys())
    .map((value) => String(value ?? ''))
    .filter((value) => value.trim().length > 0);
  const unique = Array.from(new Set(values)).sort((left, right) =>
    left.localeCompare(right, 'es'),
  );

  return unique.map((value) => ({ value, label: value }));
}

function filterOptionsBySearch(
  options: DataTableFilterOption[],
  search: string,
): DataTableFilterOption[] {
  const query = normalizeText(search);
  if (!query) return options;
  return options.filter((option) =>
    normalizeText(option.label).includes(query),
  );
}

function isDateColumn<TData>(column: Column<TData, unknown>): boolean {
  return String(column.columnDef.filterFn ?? '') === 'dateRange';
}

function activeUnitCount<TData>(column: Column<TData, unknown>): number {
  if (isDateColumn(column)) {
    return dateRangeValue(column as Column<unknown, unknown>)?.from ? 1 : 0;
  }
  return selectedValues(column as Column<unknown, unknown>).length;
}

export function FilterPanel<TData>({
  table,
  filterableColumns,
  filterOptionsByColumn,
  filterSwitches = [],
}: FilterPanelProps<TData>) {
  const [open, setOpen] = useState(false);
  const [expandedColumnIds, setExpandedColumnIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [searchByColumn, setSearchByColumn] = useState<Record<string, string>>(
    {},
  );
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [panelStyle, setPanelStyle] = useState<CSSProperties | undefined>();
  const closePanel = useCallback(() => setOpen(false), []);

  useCloseOnOutsideClick(panelRef, open, closePanel);

  const columns = filterableColumns
    .map((columnId) => table.getColumn(columnId))
    .filter((column): column is Column<TData, unknown> => Boolean(column));

  const activeCountByColumn = useMemo(() => {
    return new Map(
      columns.map((column) => [column.id, activeUnitCount(column)]),
    );
  }, [columns]);

  const activeSwitchCount = filterSwitches.filter(
    (item) => item.checked,
  ).length;

  const activeCount =
    Array.from(activeCountByColumn.values()).reduce(
      (total, count) => total + count,
      0,
    ) + activeSwitchCount;

  const updatePanelPosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;

    const triggerRect = trigger.getBoundingClientRect();
    const gutter = 18;
    const width = Math.min(340, window.innerWidth - gutter * 2);
    const maxLeft = Math.max(gutter, window.innerWidth - width - gutter);
    const left = Math.min(Math.max(triggerRect.left, gutter), maxLeft);

    setPanelStyle({
      position: 'fixed',
      top: triggerRect.bottom + 8,
      left,
      right: 'auto',
      width,
    });
  }, []);

  useEffect(() => {
    if (!open) return;

    updatePanelPosition();
    window.addEventListener('resize', updatePanelPosition);
    window.addEventListener('scroll', updatePanelPosition, true);

    return () => {
      window.removeEventListener('resize', updatePanelPosition);
      window.removeEventListener('scroll', updatePanelPosition, true);
    };
  }, [open, updatePanelPosition]);

  useEffect(() => {
    if (!open) return;
    const activeColumnIds = columns
      .filter((column) => (activeCountByColumn.get(column.id) ?? 0) > 0)
      .map((column) => column.id);
    if (activeColumnIds.length === 0) return;
    setExpandedColumnIds((current) => {
      if (activeColumnIds.every((columnId) => current.has(columnId))) {
        return current;
      }
      const next = new Set(current);
      activeColumnIds.forEach((columnId) => next.add(columnId));
      return next;
    });
  }, [activeCountByColumn, columns, open]);

  if (columns.length === 0 && filterSwitches.length === 0) return null;

  function toggleValue(column: Column<TData, unknown>, value: string): void {
    const current = selectedValues(column as Column<unknown, unknown>);
    const next = current.includes(value)
      ? current.filter((item) => item !== value)
      : [...current, value];
    column.setFilterValue(next.length > 0 ? next : undefined);
  }

  function toggleColumn(columnId: string): void {
    setExpandedColumnIds((current) => {
      const next = new Set(current);
      if (next.has(columnId)) {
        next.delete(columnId);
      } else {
        next.add(columnId);
      }
      return next;
    });
  }

  return (
    <div className="dt-menu dt-filter-menu" ref={panelRef}>
      <button
        ref={triggerRef}
        type="button"
        className={`dt-toolbar-button dt-filter-trigger ${open ? 'active' : ''}`}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <SlidersHorizontal size={16} />
        Filtros
        {activeCount > 0 ? (
          <span className="dt-button-count">{activeCount}</span>
        ) : null}
      </button>

      {open ? (
        <div
          className="dt-menu-panel dt-filter-panel"
          aria-label="Filtros de tabla"
          style={panelStyle}
        >
          <div className="dt-menu-heading dt-filter-heading">
            <span>
              Filtros
              {activeCount > 0 ? <b>{activeCount}</b> : null}
            </span>
            <button
              type="button"
              onClick={() => {
                table.resetColumnFilters();
                setSearchByColumn({});
                filterSwitches.forEach((item) => {
                  if (item.checked) item.onChange(false);
                });
              }}
            >
              <RotateCcw size={14} /> Limpiar
            </button>
          </div>

          <div className="dt-filter-list">
            {filterSwitches.map((item) => (
              <div className="dt-filter-switch-row" key={item.id}>
                <span className="dt-filter-switch-label">{item.label}</span>
                <Switch checked={item.checked} onChange={item.onChange} />
              </div>
            ))}
            {columns.map((column) => {
              const dateColumn = isDateColumn(column);

              if (dateColumn) {
                return (
                  <div className="dt-filter-date-row" key={column.id}>
                    <span className="dt-filter-date-label">
                      <CalendarDays size={15} />
                      {resolveColumnLabel(column)}
                    </span>
                    <DateRangeFilter
                      value={dateRangeValue(column as Column<unknown, unknown>)}
                      onChange={(next) => column.setFilterValue(next)}
                      placeholder="Elegir fecha"
                    />
                  </div>
                );
              }

              const count = activeCountByColumn.get(column.id) ?? 0;
              const expanded = expandedColumnIds.has(column.id);
              const options = getOptions(column, filterOptionsByColumn);
              const search = searchByColumn[column.id] ?? '';
              const visibleOptions = filterOptionsBySearch(options, search);

              return (
                <section
                  className={`dt-filter-section ${expanded ? 'open' : ''}`}
                  key={column.id}
                >
                  <button
                    type="button"
                    className="dt-filter-section-header"
                    onClick={() => toggleColumn(column.id)}
                  >
                    <SlidersHorizontal size={15} />
                    <span>{resolveColumnLabel(column)}</span>
                    {count > 0 ? <b>{count}</b> : null}
                    <ChevronDown size={16} />
                  </button>

                  {expanded ? (
                    <div className="dt-filter-options">
                      {options.length === 0 ? (
                        <p className="dt-empty-note">
                          Sin opciones disponibles.
                        </p>
                      ) : (
                        <>
                          <div className="dt-filter-search">
                            <Search size={14} />
                            <input
                              type="text"
                              value={search}
                              onChange={(event) =>
                                setSearchByColumn((current) => ({
                                  ...current,
                                  [column.id]: event.target.value,
                                }))
                              }
                              placeholder="Buscar..."
                            />
                          </div>
                          <div className="dt-filter-options-scroll">
                            {visibleOptions.length === 0 ? (
                              <p className="dt-empty-note">
                                Sin coincidencias.
                              </p>
                            ) : (
                              visibleOptions.map((option) => (
                                <label
                                  className="dt-check-row"
                                  key={option.value}
                                >
                                  <input
                                    type="checkbox"
                                    checked={selectedValues(
                                      column as Column<unknown, unknown>,
                                    ).includes(option.value)}
                                    onChange={() =>
                                      toggleValue(column, option.value)
                                    }
                                  />
                                  <span>{option.label}</span>
                                </label>
                              ))
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  ) : null}
                </section>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
