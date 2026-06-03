import { type RefObject, useEffect } from 'react';

export function useCloseOnOutsideClick<TElement extends HTMLElement>(
  ref: RefObject<TElement | null>,
  isOpen: boolean,
  onClose: () => void,
): void {
  useEffect(() => {
    if (!isOpen) return;

    function handlePointerDown(event: PointerEvent): void {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (ref.current?.contains(target)) return;
      onClose();
    }

    document.addEventListener('pointerdown', handlePointerDown, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
    };
  }, [isOpen, onClose, ref]);
}
