import { X } from 'lucide-react';
import { useEffect, useRef, type ComponentProps, type ReactNode } from 'react';
import { useEscapeKey } from '../../lib/ui/useEscapeKey';
import { EntryHistoryPanel } from '../entries/EntryHistoryPanel';

type Props = Omit<
  ComponentProps<typeof EntryHistoryPanel>,
  | 'initialCashSessionId'
  | 'initialOnlyCurrentSession'
  | 'onBackToCaja'
  | 'renderTable'
> & {
  cashSessionId: string;
  onClose: () => void;
};

function DialogFrame({
  children,
  onClose,
}: {
  children: ReactNode;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLElement>(null);
  useEscapeKey(onClose);
  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null;
    panelRef.current?.querySelector<HTMLInputElement>('input')?.focus();
    return () => trigger?.focus();
  }, []);

  return (
    <div
      className="rate-dialog-backdrop cash-session-movements-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={panelRef}
        className="rate-dialog cash-session-movements-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cash-session-movements-title"
        onKeyDown={(event) => {
          if (
            event.key !== 'Tab' ||
            !event.currentTarget.contains(document.activeElement)
          )
            return;
          const controls = event.currentTarget.querySelectorAll<HTMLElement>(
            'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
          );
          const first = controls[0];
          const last = controls[controls.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }}
      >
        <header className="rate-dialog-header">
          <div>
            <p className="rate-dialog-kicker">Historial</p>
            <h3 id="cash-session-movements-title">Movimientos de caja</h3>
          </div>
          <button
            type="button"
            className="rate-dialog-close"
            aria-label="Cerrar movimientos"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </header>
        <div className="cash-session-movements-dialog__table data-table-host">
          {children}
        </div>
      </section>
    </div>
  );
}

export function CashSessionMovementsDialog({
  cashSessionId,
  onClose,
  ...props
}: Props) {
  return (
    <EntryHistoryPanel
      {...props}
      initialCashSessionId={cashSessionId}
      renderTable={(table) => (
        <DialogFrame onClose={onClose}>{table}</DialogFrame>
      )}
    />
  );
}
