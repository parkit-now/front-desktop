import type { Column, Table } from '@tanstack/react-table';
import {
  CalendarDays,
  ChevronDown,
  RotateCcw,
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
import { useCloseOnOutsideClick } from '../../../lib/ui/useCloseOnOutsideClick';
import type { DataTableFilterOption } from '../types';

type FilterPanelProps<TData> = {
  table: Table<TData>;
  filterableColumns: string[];
  filterOptionsByColumn?: Record<string, DataTableFilterOption[]>;
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

function isDateColumn<TData>(column: Column<TData, unknown>): boolean {
  if (String(column.columnDef.filterFn ?? '') === 'dateRange') return true;
  return /date|fecha|created|updated|contacto/i.test(column.id);
}

export function FilterPanel<TData>({
  table,
  filterableColumns,
  filterOptionsByColumn,
}: FilterPanelProps<TData>) {
  const [open, setOpen] = useState(false);
  const [expandedColumnIds, setExpandedColumnIds] = useState<Set<string>>(
    () => new Set(),
  );
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [panelStyle, setPanelStyle] = useState<CSSProperties | undefined>();
  const closePanel = useCallback(() => setOpen(false), []);

  useCloseOnOutsideClick(panelRef, open, closePanel);

  const columns = filterableColumns
    .map((columnId) => table.getColumn(columnId))
    .filter((column): column is Column<TData, unknown> => Boolean(column));

  const selectedByColumn = useMemo(() => {
    return new Map(
      columns.map((column) => [
        column.id,
        selectedValues(column as Column<unknown, unknown>),
      ]),
    );
  }, [columns]);

  const activeCount = Array.from(selectedByColumn.values()).reduce(
    (total, selected) => total + selected.length,
    0,
  );

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
      .filter((column) => (selectedByColumn.get(column.id) ?? []).length > 0)
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
  }, [columns, open, selectedByColumn]);

  if (columns.length === 0) return null;

  function toggleValue(column: Column<TData, unknown>, value: string): void {
    const current = selectedByColumn.get(column.id) ?? [];
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
            <button type="button" onClick={() => table.resetColumnFilters()}>
              <RotateCcw size={14} /> Limpiar
            </button>
          </div>

          <div className="dt-filter-list">
            {columns.map((column) => {
              const selected = selectedByColumn.get(column.id) ?? [];
              const options = getOptions(column, filterOptionsByColumn);
              const dateColumn = isDateColumn(column);
              const expanded = dateColumn || expandedColumnIds.has(column.id);

              return (
                <section
                  className={`dt-filter-section ${expanded ? 'open' : ''}`}
                  key={column.id}
                >
                  <button
                    type="button"
                    className="dt-filter-section-header"
                    onClick={() => {
                      if (!dateColumn) toggleColumn(column.id);
                    }}
                    disabled={dateColumn}
                  >
                    {dateColumn ? (
                      <CalendarDays size={15} />
                    ) : (
                      <SlidersHorizontal size={15} />
                    )}
                    <span>{resolveColumnLabel(column)}</span>
                    {selected.length > 0 ? <b>{selected.length}</b> : null}
                    {!dateColumn ? <ChevronDown size={16} /> : null}
                  </button>

                  {expanded ? (
                    <div className="dt-filter-options">
                      {options.length === 0 ? (
                        <p className="dt-empty-note">
                          Sin opciones disponibles.
                        </p>
                      ) : (
                        options.map((option) => (
                          <label className="dt-check-row" key={option.value}>
                            <input
                              type="checkbox"
                              checked={selected.includes(option.value)}
                              onChange={() => toggleValue(column, option.value)}
                            />
                            <span>{option.label}</span>
                          </label>
                        ))
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
