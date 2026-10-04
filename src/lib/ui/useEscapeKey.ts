import { useEffect, useRef } from 'react';

/**
 * Pila de diálogos que escuchan Escape. Solo responde el de arriba (el último
 * que se abrió): un `ConfirmDialog` abierto dentro de un diálogo de edición
 * se cierra solo a él, sin arrastrar al diálogo de abajo.
 */
type EscapeHandler = () => void;
const stack: EscapeHandler[] = [];

export function pushEscapeHandler(handler: EscapeHandler): () => void {
  stack.push(handler);
  return () => {
    const index = stack.lastIndexOf(handler);
    if (index >= 0) stack.splice(index, 1);
  };
}

type EscapeEventLike = {
  key: string;
  defaultPrevented: boolean;
  isComposing?: boolean;
  preventDefault: () => void;
};

/** Devuelve true si el evento fue consumido por el diálogo de arriba. */
export function dispatchEscape(event: EscapeEventLike): boolean {
  if (event.key !== 'Escape') return false;
  // Un select/desplegable propio ya usó este Escape para cerrarse a sí mismo.
  if (event.defaultPrevented || event.isComposing) return false;
  const top = stack[stack.length - 1];
  if (!top) return false;
  event.preventDefault();
  top();
  return true;
}

let listening = false;
function ensureListener(): void {
  if (listening || typeof document === 'undefined') return;
  listening = true;
  document.addEventListener('keydown', (event) => {
    dispatchEscape(event);
  });
}

/**
 * Cierra un diálogo con Escape. Con `enabled = false` (guardando, por
 * ejemplo) el diálogo sigue en la pila y absorbe el Escape sin hacer nada,
 * igual que el botón "Cerrar" deshabilitado. `active` es para componentes
 * que siempre están montados pero solo a veces visibles.
 */
export function useEscapeKey(
  onEscape: () => void,
  enabled = true,
  active = true,
): void {
  const latest = useRef({ onEscape, enabled });
  latest.current = { onEscape, enabled };

  useEffect(() => {
    if (!active) return;
    ensureListener();
    return pushEscapeHandler(() => {
      if (latest.current.enabled) latest.current.onEscape();
    });
  }, [active]);
}
