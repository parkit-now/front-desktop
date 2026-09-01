import { ChevronDown } from 'lucide-react';
import React, {
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';

export interface AppSelectOption {
  value: string;
  label: string;
}

export interface AppSelectHandle {
  focus: () => void;
}

export interface AppSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: AppSelectOption[];
  placeholder?: string;
  error?: boolean;
  disabled?: boolean;
  /**
   * Called for keys not handled internally (dropdown closed + key is not arrow/space/escape).
   * Useful for shortcuts like 1–9 in the rate selector.
   */
  onKeyDown?: (e: React.KeyboardEvent<HTMLButtonElement>) => void;
  id?: string;
}

export const AppSelect = React.forwardRef<AppSelectHandle, AppSelectProps>(
  (
    { value, onChange, options, placeholder, error, disabled, onKeyDown, id },
    ref,
  ) => {
    const [open, setOpen] = useState(false);
    const [highlighted, setHighlighted] = useState(0);
    const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({});
    const triggerRef = useRef<HTMLButtonElement>(null);
    const listRef = useRef<HTMLUListElement>(null);

    useImperativeHandle(ref, () => ({
      focus: () => triggerRef.current?.focus(),
    }));

    const selectedOption = options.find((o) => o.value === value);

    function calcPosition() {
      if (!triggerRef.current) return;
      const rect = triggerRef.current.getBoundingClientRect();
      setDropdownStyle({
        position: 'fixed',
        top: rect.bottom + 4,
        left: rect.left,
        width: rect.width,
        zIndex: 200,
      });
    }

    function openDropdown() {
      if (disabled) return;
      calcPosition();
      const idx = options.findIndex((o) => o.value === value);
      setHighlighted(idx >= 0 ? idx : 0);
      setOpen(true);
    }

    function closeDropdown() {
      setOpen(false);
    }

    function selectOption(opt: AppSelectOption) {
      onChange(opt.value);
      closeDropdown();
      triggerRef.current?.focus();
    }

    // Recalculate position on open (handles resize edge cases)
    useLayoutEffect(() => {
      if (open && triggerRef.current) {
        const rect = triggerRef.current.getBoundingClientRect();
        setDropdownStyle({
          position: 'fixed',
          top: rect.bottom + 4,
          left: rect.left,
          width: rect.width,
          zIndex: 200,
        });
      }
    }, [open]);

    /**
     * Trae a la vista la opción resaltada al navegar con las flechas.
     *
     * Con las 8 opciones fijas del enum viejo esto era invisible: entraban
     * enteras en los 260px de `.vehicle-suggestions`. Ahora los tipos son por
     * estacionamiento y pueden ser N, así que sin esto el highlight se camina
     * fuera de pantalla y el usuario navega a ciegas.
     */
    useEffect(() => {
      if (!open) return;
      const item = listRef.current?.children[highlighted];
      if (item instanceof HTMLElement) {
        item.scrollIntoView({ block: 'nearest' });
      }
    }, [highlighted, open]);

    // Close on outside click
    useEffect(() => {
      if (!open) return;
      function handleOutside(e: MouseEvent) {
        if (
          !triggerRef.current?.contains(e.target as Node) &&
          !listRef.current?.contains(e.target as Node)
        ) {
          closeDropdown();
        }
      }
      document.addEventListener('mousedown', handleOutside);
      return () => document.removeEventListener('mousedown', handleOutside);
    }, [open]);

    /**
     * El dropdown vive en un portal con `position: fixed`, así que hay que
     * reacomodarlo cuando algo se mueve debajo.
     *
     * Antes esto simplemente cerraba la lista en cualquier scroll, y como el
     * listener corre en CAPTURA también veía el scroll de sus propios hijos:
     * scrollear dentro de la lista de opciones la cerraba en la cara del
     * usuario. Ahora se ignora el scroll interno y se reposiciona en vez de
     * cerrar, que además es mejor que perder la selección a mitad de camino.
     */
    useEffect(() => {
      if (!open) return;

      function handleReposition(event: Event) {
        if (
          event.target instanceof Node &&
          listRef.current?.contains(event.target)
        ) {
          return;
        }

        const rect = triggerRef.current?.getBoundingClientRect();
        if (!rect) return;

        // Si el campo se fue de la pantalla, un dropdown flotando solo sería
        // un huérfano: ahí sí conviene cerrarlo.
        if (rect.bottom < 0 || rect.top > window.innerHeight) {
          closeDropdown();
          return;
        }

        calcPosition();
      }

      window.addEventListener('scroll', handleReposition, true);
      window.addEventListener('resize', handleReposition);
      return () => {
        window.removeEventListener('scroll', handleReposition, true);
        window.removeEventListener('resize', handleReposition);
      };
    }, [open]);

    function handleKeyDown(e: React.KeyboardEvent<HTMLButtonElement>) {
      // Tab: close if open, let browser advance focus naturally
      if (e.key === 'Tab') {
        if (open) closeDropdown();
        onKeyDown?.(e);
        return;
      }

      // When dropdown is open: handle navigation internally, don't call prop
      if (open) {
        switch (e.key) {
          case 'ArrowDown':
            setHighlighted((h) => Math.min(options.length - 1, h + 1));
            e.preventDefault();
            return;
          case 'ArrowUp':
            setHighlighted((h) => Math.max(0, h - 1));
            e.preventDefault();
            return;
          case 'Enter':
          case ' ':
            if (highlighted >= 0 && highlighted < options.length) {
              selectOption(options[highlighted]);
            }
            e.preventDefault();
            return;
          case 'Escape':
            closeDropdown();
            e.preventDefault();
            return;
        }
        return;
      }

      // Dropdown is closed: call prop handler first (1–9 shortcuts, Enter for submit)
      onKeyDown?.(e);
      if (e.defaultPrevented) return;

      // Then handle opening
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === ' ') {
        openDropdown();
        e.preventDefault();
      }
    }

    return (
      <div className={`app-select-wrap${error ? ' app-select-error' : ''}`}>
        <button
          ref={triggerRef}
          type="button"
          id={id}
          role="combobox"
          aria-expanded={open}
          aria-haspopup="listbox"
          className="app-select-trigger"
          disabled={disabled}
          onClick={() => (open ? closeDropdown() : openDropdown())}
          onKeyDown={handleKeyDown}
        >
          {selectedOption ? (
            <span className="app-select-value">{selectedOption.label}</span>
          ) : (
            <span className="app-select-placeholder">{placeholder ?? ''}</span>
          )}
          <ChevronDown
            className={`app-select-chevron-icon${open ? ' open' : ''}`}
            size={16}
          />
        </button>

        {open &&
          createPortal(
            <ul
              ref={listRef}
              className="vehicle-suggestions"
              style={dropdownStyle}
              role="listbox"
            >
              {options.map((o, i) => (
                <li
                  key={o.value}
                  role="option"
                  aria-selected={o.value === value}
                  className={[
                    'vehicle-suggestion',
                    'vehicle-suggestion--model',
                    i === highlighted ? 'vehicle-suggestion--highlighted' : '',
                    o.value === value ? 'vehicle-suggestion--selected' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    selectOption(o);
                  }}
                  onMouseEnter={() => setHighlighted(i)}
                >
                  {o.label}
                </li>
              ))}
            </ul>,
            document.body,
          )}
      </div>
    );
  },
);

AppSelect.displayName = 'AppSelect';
