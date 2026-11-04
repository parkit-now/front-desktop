import { Check, ChevronDown, Search, X } from 'lucide-react';
import {
  useCallback,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { useCloseOnOutsideClick } from '../../../lib/ui/useCloseOnOutsideClick';
import { useEscapeKey } from '../../../lib/ui/useEscapeKey';
import type { DataTableSearchMode } from '../types';

type SearchMode = Pick<
  DataTableSearchMode<unknown>,
  'id' | 'label' | 'placeholder'
>;

type TableSearchProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  modes?: readonly SearchMode[];
  modeId?: string;
  onModeChange?: (id: string) => void;
};

export function TableSearch({
  value,
  onChange,
  placeholder,
  modes,
  modeId,
  onModeChange,
}: TableSearchProps) {
  const [open, setOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const menuId = useId();
  const mode = modes?.find((item) => item.id === modeId) ?? modes?.[0];
  const closeMenu = useCallback(() => setOpen(false), []);

  useCloseOnOutsideClick(rootRef, open, closeMenu);
  useEscapeKey(
    () => {
      closeMenu();
      triggerRef.current?.focus();
    },
    true,
    open,
  );

  useLayoutEffect(() => {
    if (open) optionRefs.current[focusedIndex]?.focus();
  }, [focusedIndex, open]);

  function openMenu(
    index = modes?.findIndex((item) => item.id === mode?.id) ?? 0,
  ) {
    setFocusedIndex(Math.max(0, index));
    setOpen(true);
  }

  function selectMode(id: string) {
    onModeChange?.(id);
    closeMenu();
    inputRef.current?.focus();
  }

  function handleMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const count = modes?.length ?? 0;
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setFocusedIndex((index) => (index + 1) % count);
        break;
      case 'ArrowUp':
        event.preventDefault();
        setFocusedIndex((index) => (index - 1 + count) % count);
        break;
      case 'Home':
        event.preventDefault();
        setFocusedIndex(0);
        break;
      case 'End':
        event.preventDefault();
        setFocusedIndex(count - 1);
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        if (modes?.[focusedIndex]) selectMode(modes[focusedIndex].id);
        break;
      case 'Tab':
        closeMenu();
        triggerRef.current?.focus();
        break;
    }
  }

  return (
    <div
      className="dt-search"
      ref={rootRef}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) closeMenu();
      }}
    >
      <Search size={17} aria-hidden="true" />
      <input
        ref={inputRef}
        type="search"
        aria-label="Buscar en la tabla"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onFocus={closeMenu}
        placeholder={mode?.placeholder ?? placeholder}
      />
      {value ? (
        <button
          type="button"
          className="dt-search-clear"
          onClick={() => {
            onChange('');
            inputRef.current?.focus();
          }}
          title="Limpiar búsqueda"
          aria-label="Limpiar búsqueda"
        >
          <X size={15} aria-hidden="true" />
        </button>
      ) : null}
      {mode ? (
        <button
          ref={triggerRef}
          type="button"
          className="dt-search-clear dt-search-mode-toggle"
          aria-label="Campo de búsqueda"
          title={`Buscar en: ${mode.label}`}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? menuId : undefined}
          onClick={() => (open ? closeMenu() : openMenu())}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              openMenu(event.key === 'ArrowUp' ? (modes?.length ?? 1) - 1 : 0);
            }
          }}
        >
          <ChevronDown size={15} aria-hidden="true" />
        </button>
      ) : null}
      {open && mode ? (
        <div
          id={menuId}
          role="menu"
          aria-label="Campo de búsqueda"
          className="dt-search-mode-menu"
          onKeyDown={handleMenuKeyDown}
        >
          {modes?.map((item, index) => (
            <button
              key={item.id}
              ref={(element) => {
                optionRefs.current[index] = element;
              }}
              type="button"
              role="menuitemradio"
              aria-checked={item.id === mode.id}
              tabIndex={index === focusedIndex ? 0 : -1}
              onFocus={() => setFocusedIndex(index)}
              onClick={() => selectMode(item.id)}
              className="dt-search-mode-option"
            >
              <span>{item.label}</span>
              <span className="dt-search-mode-check" aria-hidden="true">
                {item.id === mode.id ? <Check size={15} /> : null}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
