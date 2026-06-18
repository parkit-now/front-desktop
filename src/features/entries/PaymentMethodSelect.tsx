import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';

interface Option {
  id: string;
  name: string;
}

interface Props {
  options: Option[];
  value: string;
  onChange: (id: string) => void;
  ariaLabel?: string;
}

/**
 * Dropdown selector with rounded styling and a controlled chevron.
 * Native <select> popups in Chromium cannot be rounded, so this renders its
 * own listbox while keeping select-like keyboard and click behaviour.
 */
export function PaymentMethodSelect({
  options,
  value,
  onChange,
  ariaLabel,
}: Props) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.id === value);

  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(event: MouseEvent): void {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [open]);

  function move(delta: number): void {
    const idx = options.findIndex((o) => o.id === value);
    const next =
      options[Math.min(options.length - 1, Math.max(0, idx + delta))];
    if (next) onChange(next.id);
  }

  function onKeyDown(event: React.KeyboardEvent): void {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!open) setOpen(true);
      else move(1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) setOpen(true);
      else move(-1);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      setOpen((v) => !v);
    } else if (event.key === 'Escape') {
      setOpen(false);
    }
  }

  return (
    <div className="exit-select" ref={containerRef}>
      <button
        type="button"
        className="exit-select-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onKeyDown}
      >
        <span>{selected?.name ?? 'Seleccionar'}</span>
        <ChevronDown
          size={18}
          className={`exit-select-chevron${open ? ' is-open' : ''}`}
          aria-hidden="true"
        />
      </button>
      {open ? (
        <ul className="exit-select-list" role="listbox" aria-label={ariaLabel}>
          {options.map((o) => (
            <li
              key={o.id}
              role="option"
              aria-selected={o.id === value}
              className={`exit-select-option${o.id === value ? ' is-active' : ''}`}
              onClick={() => {
                onChange(o.id);
                setOpen(false);
              }}
            >
              {o.name}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
