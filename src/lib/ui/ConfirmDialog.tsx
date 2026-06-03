import { AlertTriangle, Trash2, X } from 'lucide-react';

export type ConfirmDialogVariant = 'default' | 'warning' | 'danger';

export type ConfirmDialogProps = {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  variant?: ConfirmDialogVariant;
  isPending?: boolean;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
};

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel = 'Cancelar',
  variant = 'default',
  isPending = false,
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  if (!open) return null;

  const Icon = variant === 'danger' ? Trash2 : AlertTriangle;

  return (
    <div
      className="confirm-dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isPending) onCancel();
      }}
    >
      <section
        className={`confirm-dialog confirm-dialog-${variant}`}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-message"
      >
        <div className="confirm-dialog-top">
          <span className="confirm-dialog-icon" aria-hidden="true">
            <Icon size={22} />
          </span>
          <button
            type="button"
            className="confirm-dialog-close"
            onClick={onCancel}
            disabled={isPending}
            aria-label="Cerrar confirmación"
          >
            <X size={17} />
          </button>
        </div>

        <div>
          <p className="confirm-dialog-kicker">Confirmación</p>
          <h3 id="confirm-dialog-title">{title}</h3>
          <p id="confirm-dialog-message">{message}</p>
        </div>

        <div className="confirm-dialog-actions">
          <button
            type="button"
            className="ghost-button"
            onClick={onCancel}
            disabled={isPending}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className={`confirm-dialog-primary ${variant}`}
            onClick={() => {
              void onConfirm();
            }}
            disabled={isPending}
          >
            {isPending ? 'Procesando...' : confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}
