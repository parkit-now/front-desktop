export type InvoiceChoice = 'A' | 'B';

interface Props {
  letter: InvoiceChoice;
  onLetterChange: (letter: InvoiceChoice) => void;
  cuit: string;
  onCuitChange: (cuit: string) => void;
  onCuitBlur?: () => void;
  /** Mensaje del campo CUIT; se muestra sólo si el operario ya lo tocó. */
  cuitError: string | null;
  disabled?: boolean;
  /** `false` cuando ya hay un título arriba (el panel «Emitir factura»). */
  showLabel?: boolean;
}

/**
 * Factura B (consumidor final, la de siempre) o A (el cliente da su CUIT).
 * Sólo se muestra si la playa es Responsable Inscripto: un monotributista
 * emite C y no hay nada que elegir.
 */
export function InvoiceTypeChooser({
  letter,
  onLetterChange,
  cuit,
  onCuitChange,
  onCuitBlur,
  cuitError,
  disabled,
  showLabel = true,
}: Props) {
  return (
    <div className="form-field exit-invoice-choice">
      {showLabel ? (
        <span className="form-label" id="exit-invoice-type-label">
          Factura
        </span>
      ) : null}
      <div
        className="exit-invoice-segments"
        role="radiogroup"
        aria-labelledby={showLabel ? 'exit-invoice-type-label' : undefined}
        aria-label={showLabel ? undefined : 'Tipo de factura'}
      >
        {(['B', 'A'] as const).map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={letter === option}
            className={letter === option ? 'active' : undefined}
            onClick={() => onLetterChange(option)}
            disabled={disabled}
          >
            Factura {option}
          </button>
        ))}
      </div>
      {letter === 'A' ? (
        <div className="exit-invoice-cuit">
          <label className="form-label" htmlFor="exit-invoice-cuit">
            CUIT del cliente
          </label>
          <input
            id="exit-invoice-cuit"
            type="text"
            inputMode="numeric"
            placeholder="30-71234567-1"
            value={cuit}
            maxLength={13}
            onChange={(e) => onCuitChange(e.target.value)}
            onBlur={onCuitBlur}
            disabled={disabled}
            autoFocus
            aria-invalid={cuitError ? true : undefined}
            className={cuitError ? 'input-error' : undefined}
          />
          {cuitError ? (
            <p className="field-error">{cuitError}</p>
          ) : (
            <p className="form-helper">
              Pedile el CUIT al cliente. Con o sin guiones.
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
