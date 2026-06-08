import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Column, Table } from '@tanstack/react-table';
import { Columns3, GripVertical, Pin, RotateCcw } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import { useCloseOnOutsideClick } from '../../../lib/ui/useCloseOnOutsideClick';
import { dedupeIds, NON_PICKABLE_COLUMN_IDS } from '../utils';

type ColumnPickerProps<TData> = {
  table: Table<TData>;
  columnOrder: string[];
  onResetColumns: () => void;
};

type PickerColumn<TData> = Column<TData, unknown>;

function resolveColumnLabel<TData>(column: PickerColumn<TData>): string {
  const header = column.columnDef.header;
  return typeof header === 'string' && header.trim().length > 0
    ? header
    : column.id;
}

function canPickColumn<TData>(column: PickerColumn<TData>): boolean {
  return column.getCanHide() && !NON_PICKABLE_COLUMN_IDS.has(column.id);
}

function ColumnRow<TData>({
  column,
  isPinned,
  onPinChange,
  onVisibilityChange,
}: {
  column: PickerColumn<TData>;
  isPinned: boolean;
  onPinChange: () => void;
  onVisibilityChange: (visible: boolean) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({ id: column.id, disabled: isPinned });
  const label = resolveColumnLabel(column);
  const checkboxId = `dt-column-${column.id}`;

  return (
    <div
      ref={setNodeRef}
      className={`dt-column-row ${isPinned ? 'pinned' : ''}`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <button
        type="button"
        className="dt-drag-handle"
        disabled={isPinned}
        aria-label="Arrastrar columna"
        {...attributes}
        {...listeners}
      >
        <GripVertical size={15} />
      </button>
      <input
        id={checkboxId}
        type="checkbox"
        checked={column.getIsVisible()}
        onChange={(event) => onVisibilityChange(event.target.checked)}
      />
      <label htmlFor={checkboxId}>{label}</label>
      <button
        type="button"
        className={`dt-pin-button ${isPinned ? 'active' : ''}`}
        disabled={!column.getIsVisible()}
        onClick={onPinChange}
        title={isPinned ? 'Desfijar columna' : 'Fijar a la izquierda'}
      >
        <Pin size={14} />
      </button>
    </div>
  );
}

export function ColumnPicker<TData>({
  table,
  columnOrder,
  onResetColumns,
}: ColumnPickerProps<TData>) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const closeMenu = useCallback(() => setOpen(false), []);

  useCloseOnOutsideClick(menuRef, open, closeMenu);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const allColumns = table.getAllLeafColumns() as PickerColumn<TData>[];
  const byId = new Map(allColumns.map((column) => [column.id, column]));
  const orderedColumns = columnOrder
    .map((columnId) => byId.get(columnId))
    .filter((column): column is PickerColumn<TData> => Boolean(column));
  const orderedIds = new Set(orderedColumns.map((column) => column.id));
  const columns = [
    ...orderedColumns,
    ...allColumns.filter((column) => !orderedIds.has(column.id)),
  ];
  const pickableColumns = columns.filter(canPickColumn);
  const pinnedLeftIds = dedupeIds(table.getState().columnPinning.left ?? []);
  const pinnedLeftSet = new Set(pinnedLeftIds);
  const pinnedColumns = pickableColumns.filter((column) =>
    pinnedLeftSet.has(column.id),
  );
  const unpinnedColumns = pickableColumns.filter(
    (column) => !pinnedLeftSet.has(column.id),
  );
  const nonPickableIds = allColumns
    .filter((column) => !canPickColumn(column))
    .map((column) => column.id);

  if (pickableColumns.length === 0) return null;

  function setOrderedColumns(pinnedIds: string[], unpinnedIds: string[]): void {
    table.setColumnOrder(
      dedupeIds([...pinnedIds, ...unpinnedIds, ...nonPickableIds]),
    );
  }

  function handleDragEnd(event: DragEndEvent): void {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const ids = unpinnedColumns.map((column) => column.id);
    const oldIndex = ids.indexOf(String(active.id));
    const newIndex = ids.indexOf(String(over.id));
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = arrayMove(ids, oldIndex, newIndex);
    setOrderedColumns(
      pinnedColumns.map((column) => column.id),
      reordered,
    );
  }

  function handleVisibilityChange(
    column: PickerColumn<TData>,
    visible: boolean,
  ): void {
    column.toggleVisibility(visible);
    if (!visible) column.pin(false);
  }

  function handlePinChange(column: PickerColumn<TData>): void {
    const nextPinned = new Set(pinnedColumns.map((item) => item.id));
    if (nextPinned.has(column.id)) {
      nextPinned.delete(column.id);
      column.pin(false);
    } else {
      nextPinned.add(column.id);
      column.pin('left');
    }

    const pickableIds = pickableColumns.map((item) => item.id);
    const pinnedIds = pickableIds.filter((columnId) =>
      nextPinned.has(columnId),
    );
    const unpinnedIds = pickableIds.filter(
      (columnId) => !nextPinned.has(columnId),
    );
    table.setColumnPinning({
      ...table.getState().columnPinning,
      left: pinnedIds,
    });
    setOrderedColumns(pinnedIds, unpinnedIds);
  }

  return (
    <div className="dt-menu dt-column-menu" ref={menuRef}>
      <button
        type="button"
        className="dt-icon-button"
        title="Columnas visibles"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <Columns3 size={17} />
        <span className="dt-sr-only">Columnas</span>
      </button>
      {open ? (
        <div className="dt-menu-panel dt-column-panel">
          <div className="dt-menu-heading">
            <span>Columnas</span>
            <button type="button" onClick={onResetColumns}>
              <RotateCcw size={14} /> Reiniciar
            </button>
          </div>
          <p className="dt-menu-hint">Arrastrá para ordenar y fijá columnas.</p>

          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            {pinnedColumns.length > 0 ? (
              <div className="dt-column-group">
                <span className="dt-column-group-label">Fijas</span>
                {pinnedColumns.map((column) => (
                  <ColumnRow
                    key={column.id}
                    column={column}
                    isPinned
                    onPinChange={() => handlePinChange(column)}
                    onVisibilityChange={(visible) =>
                      handleVisibilityChange(column, visible)
                    }
                  />
                ))}
              </div>
            ) : null}

            <SortableContext
              items={unpinnedColumns.map((column) => column.id)}
              strategy={verticalListSortingStrategy}
            >
              <div className="dt-column-group">
                {unpinnedColumns.map((column) => (
                  <ColumnRow
                    key={column.id}
                    column={column}
                    isPinned={false}
                    onPinChange={() => handlePinChange(column)}
                    onVisibilityChange={(visible) =>
                      handleVisibilityChange(column, visible)
                    }
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </div>
      ) : null}
    </div>
  );
}
