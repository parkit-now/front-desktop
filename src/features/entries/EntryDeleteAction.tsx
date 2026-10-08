import { Trash2 } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

interface Props {
  plate: string;
  blockers: string[];
  onClick: () => void;
}

export function EntryDeleteAction({ plate, blockers, onClick }: Props) {
  const id = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [position, setPosition] = useState<{
    top: number;
    left: number;
    transform?: string;
  } | null>(null);
  const blocked = blockers.length > 0;
  const description = blocked
    ? blockers.join(' ')
    : `Eliminar ingreso de ${plate}`;

  function showTooltip() {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect) {
      const above = rect.bottom > window.innerHeight - 110;
      setPosition({
        top: above ? rect.top - 6 : rect.bottom + 6,
        left: Math.max(8, Math.min(rect.left, window.innerWidth - 306)),
        transform: above ? 'translateY(-100%)' : undefined,
      });
    }
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="entry-delete-action"
        aria-label={`Eliminar ingreso de ${plate}`}
        aria-disabled={blocked}
        aria-describedby={blocked ? id : undefined}
        onMouseEnter={showTooltip}
        onMouseLeave={() => setPosition(null)}
        onFocus={showTooltip}
        onBlur={() => setPosition(null)}
        onClick={(event) => {
          event.stopPropagation();
          if (!blocked) {
            setPosition(null);
            onClick();
          }
        }}
      >
        <Trash2 size={16} aria-hidden="true" />
      </button>
      {blocked &&
        position &&
        createPortal(
          <span
            id={id}
            role="tooltip"
            className="entry-delete-tooltip"
            style={position}
          >
            {description}
          </span>,
          document.body,
        )}
      {blocked && !position && (
        <span id={id} className="sr-only">
          {description}
        </span>
      )}
    </>
  );
}
