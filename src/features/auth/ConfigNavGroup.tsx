import { ChevronDown, ChevronRight, Settings } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

export type ConfigNavItem<S extends string> = {
  section: S;
  label: string;
  icon: ReactNode;
};

type Props<S extends string> = {
  label: string;
  items: ConfigNavItem<S>[];
  activeSection: string;
  /** Sidebar colapsada: el grupo muestra sólo el ícono y abre un popover. */
  collapsed: boolean;
  onSelect: (section: S) => void;
};

const STORAGE_KEY = 'parkit.desktop.nav.configExpanded';

function readExpanded(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function writeExpanded(value: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, value ? '1' : '0');
  } catch {
    // Sin storage el grupo arranca cerrado: no es grave.
  }
}

/**
 * Grupo desplegable del sidebar ("Configuración"). Se abre solo cuando la
 * sección activa es una de sus hijas, y recuerda si estaba abierto. Con el
 * sidebar colapsado no hay lugar para los hijos en línea: abre un popover
 * (posición fija, porque el sidebar recorta lo que se sale de él).
 */
export function ConfigNavGroup<S extends string>({
  label,
  items,
  activeSection,
  collapsed,
  onSelect,
}: Props<S>) {
  const [expanded, setExpanded] = useState<boolean>(readExpanded);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [popoverTop, setPopoverTop] = useState(0);
  const headerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const childActive = items.some((item) => item.section === activeSection);

  const updateExpanded = useCallback((value: boolean) => {
    setExpanded(value);
    writeExpanded(value);
  }, []);

  // Entrar a una hija (desde cualquier lado) abre el grupo.
  useEffect(() => {
    if (childActive) updateExpanded(true);
  }, [childActive, updateExpanded]);

  // Al expandir/colapsar el sidebar el popover pierde sentido.
  useEffect(() => {
    setPopoverOpen(false);
  }, [collapsed]);

  useEffect(() => {
    if (!popoverOpen) return;
    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (
        popoverRef.current?.contains(target) ||
        headerRef.current?.contains(target)
      ) {
        return;
      }
      setPopoverOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setPopoverOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [popoverOpen]);

  if (items.length === 0) return null;

  function handleHeaderClick() {
    if (collapsed) {
      const rect = headerRef.current?.getBoundingClientRect();
      if (rect) setPopoverTop(rect.top);
      setPopoverOpen((open) => !open);
      return;
    }
    updateExpanded(!expanded);
  }

  const showChildren = !collapsed && expanded;
  const Chevron = expanded ? ChevronDown : ChevronRight;

  return (
    <div className="nav-group">
      <button
        ref={headerRef}
        type="button"
        className={`nav-item nav-group__header ${
          childActive && !showChildren ? 'active' : ''
        }`}
        onClick={handleHeaderClick}
        aria-expanded={collapsed ? popoverOpen : expanded}
        aria-haspopup={collapsed ? 'menu' : undefined}
        aria-label={collapsed ? label : undefined}
        title={collapsed ? label : undefined}
      >
        <Settings size={18} aria-hidden="true" />
        {!collapsed ? (
          <>
            <span>{label}</span>
            <Chevron
              size={16}
              aria-hidden="true"
              className="nav-group__chevron"
            />
          </>
        ) : null}
      </button>

      {showChildren ? (
        <div className="nav-group__children">
          {items.map((item) => (
            <button
              key={item.section}
              type="button"
              className={`nav-item nav-group__child ${
                activeSection === item.section ? 'active' : ''
              }`}
              onClick={() => onSelect(item.section)}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      ) : null}

      {collapsed && popoverOpen ? (
        <div
          ref={popoverRef}
          className="nav-group__popover"
          role="menu"
          aria-label={label}
          style={{ top: popoverTop }}
        >
          <p className="nav-group__popover-title">{label}</p>
          {items.map((item) => (
            <button
              key={item.section}
              type="button"
              role="menuitem"
              className={`nav-group__popover-item ${
                activeSection === item.section ? 'active' : ''
              }`}
              onClick={() => {
                setPopoverOpen(false);
                onSelect(item.section);
              }}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
