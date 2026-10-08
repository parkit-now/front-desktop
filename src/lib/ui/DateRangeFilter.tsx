import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import {
  Calendar as CalendarIcon,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  X,
} from 'lucide-react';
import {
  type CSSProperties,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { DayPicker, type DateRange } from 'react-day-picker';
import {
  POPOVER_PANEL_ATTRIBUTE,
  useCloseOnOutsideClick,
} from './useCloseOnOutsideClick';

export type { DateRange };

interface DateRangeFilterProps {
  value: DateRange | undefined;
  onChange: (value: DateRange | undefined) => void;
  placeholder?: string;
  className?: string;
}

const PANEL_WIDTH = 300;
const YEAR_SPAN = 5;

function formatLabel(value: DateRange | undefined): string | null {
  if (!value?.from) return null;
  const from = format(value.from, 'd/M');
  if (!value.to || value.to.getTime() === value.from.getTime()) return from;
  return `${from} - ${format(value.to, 'd/M')}`;
}

export function DateRangeFilter({
  value,
  onChange,
  placeholder = 'Elegir fecha',
  className,
}: DateRangeFilterProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [panelStyle, setPanelStyle] = useState<CSSProperties>();

  const close = useCallback(() => setOpen(false), []);
  useCloseOnOutsideClick(triggerRef, open, close);

  // El panel es `fixed`: si se sale de la ventana, scrollear no lo trae de
  // vuelta. Con el trigger cerca del borde inferior (p. ej. el filtro "Cierre"
  // del historial de caja) los días quedaban fuera de pantalla e inclickeables,
  // así que se abre hacia arriba si abajo no entra, y si tampoco entra arriba se
  // ajusta para quedar dentro de la ventana.
  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const gutter = 12;
    const offset = 6;
    const rect = trigger.getBoundingClientRect();
    const maxLeft = Math.max(gutter, window.innerWidth - PANEL_WIDTH - gutter);
    const height = panelRef.current?.offsetHeight ?? 0;
    const below = rect.bottom + offset;
    const above = rect.top - offset - height;
    let top = below;
    if (below + height > window.innerHeight - gutter) {
      top =
        above >= gutter
          ? above
          : Math.max(gutter, window.innerHeight - height - gutter);
    }
    setPanelStyle({
      position: 'fixed',
      top,
      left: Math.min(rect.left, maxLeft),
      zIndex: 200,
    });
  }, []);

  // Layout effect: se posiciona antes del primer paint, sin un frame en el
  // lugar equivocado. El ResizeObserver cubre el cambio de alto entre meses de
  // 5 y 6 semanas.
  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    const observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(updatePosition);
    if (panelRef.current) observer?.observe(panelRef.current);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
      observer?.disconnect();
    };
  }, [open, updatePosition]);

  const label = formatLabel(value);
  const now = new Date();

  return (
    <div className="date-range-filter">
      <button
        ref={triggerRef}
        type="button"
        className={`date-range-filter-trigger${label ? ' has-value' : ''}${className ? ` ${className}` : ''}`}
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <CalendarIcon size={15} />
        <span>{label ?? placeholder}</span>
        {label ? (
          <span
            className="date-range-filter-clear"
            role="button"
            tabIndex={-1}
            onClick={(event) => {
              event.stopPropagation();
              onChange(undefined);
            }}
          >
            <X size={13} />
          </span>
        ) : null}
      </button>

      {open &&
        createPortal(
          <div
            ref={panelRef}
            className="date-range-filter-panel"
            style={panelStyle}
            {...{ [POPOVER_PANEL_ATTRIBUTE]: true }}
          >
            <DayPicker
              mode="range"
              selected={value}
              onSelect={onChange}
              locale={es}
              defaultMonth={value?.from ?? now}
              captionLayout="dropdown"
              navLayout="around"
              startMonth={new Date(now.getFullYear() - YEAR_SPAN, 0)}
              endMonth={new Date(now.getFullYear() + YEAR_SPAN, 11)}
              classNames={{
                root: 'dr-cal',
                months: 'dr-cal-months',
                month: 'dr-cal-month',
                month_caption: 'dr-cal-caption',
                dropdowns: 'dr-cal-dropdowns',
                dropdown_root: 'dr-cal-dropdown-root',
                dropdown: 'dr-cal-dropdown',
                caption_label: 'dr-cal-caption-label',
                button_previous: 'dr-cal-nav-prev',
                button_next: 'dr-cal-nav-next',
                chevron: 'dr-cal-chevron',
                month_grid: 'dr-cal-grid',
                weekdays: 'dr-cal-weekdays',
                weekday: 'dr-cal-weekday',
                weeks: 'dr-cal-weeks',
                week: 'dr-cal-week',
                day: 'dr-cal-day',
                day_button: 'dr-cal-day-button',
                selected: 'is-selected',
                range_start: 'is-range-start',
                range_middle: 'is-range-middle',
                range_end: 'is-range-end',
                today: 'is-today',
                outside: 'is-outside',
                disabled: 'is-disabled',
              }}
              formatters={{
                formatMonthDropdown: (month) =>
                  month.toLocaleString('es', { month: 'short' }),
              }}
              components={{
                Chevron: ({ orientation, size, className: chevronClass }) => {
                  if (orientation === 'left')
                    return (
                      <ChevronLeft size={size ?? 16} className={chevronClass} />
                    );
                  if (orientation === 'right')
                    return (
                      <ChevronRight
                        size={size ?? 16}
                        className={chevronClass}
                      />
                    );
                  return (
                    <ChevronDown size={size ?? 14} className={chevronClass} />
                  );
                },
              }}
            />
          </div>,
          document.body,
        )}
    </div>
  );
}
