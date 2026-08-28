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
  useEffect,
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
  const [panelStyle, setPanelStyle] = useState<CSSProperties>();

  const close = useCallback(() => setOpen(false), []);
  useCloseOnOutsideClick(triggerRef, open, close);

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const gutter = 12;
    const rect = trigger.getBoundingClientRect();
    const maxLeft = Math.max(gutter, window.innerWidth - PANEL_WIDTH - gutter);
    setPanelStyle({
      position: 'fixed',
      top: rect.bottom + 6,
      left: Math.min(rect.left, maxLeft),
      zIndex: 200,
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
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
