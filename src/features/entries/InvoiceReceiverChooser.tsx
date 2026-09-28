import { useId } from 'react';
import type { ArcaTaxCondition } from '../../lib/api/arca';
import {
  describeTaxpayerLookup,
  formatCuit,
  consumerFinalLetter,
  type ReceiverChoice,
} from './invoiceUtils';
import type { InvoiceReceiverState } from './useInvoiceReceiver';

interface Props {
  receiver: InvoiceReceiverState;
  /** Condición IVA de la playa: decide la letra a consumidor final. */
  emitter: ArcaTaxCondition | null | undefined;
  isOnline: boolean;
  disabled?: boolean;
  /** `false` cuando ya hay un título arriba (el panel «Emitir factura»). */
  showLabel?: boolean;
}

const OPTIONS: readonly { value: ReceiverChoice; label: string }[] = [
  { value: 'final', label: 'Consumidor Final' },
  { value: 'cuit', label: 'Con CUIT' },
];

/**
 * A quién se factura: consumidor final (la de siempre) o el CUIT que da el
 * cliente. La letra no se elige: con CUIT la decide el padrón de ARCA (A si
 * la playa es RI y el cliente RI o monotributista) y se muestra abajo antes
 * de confirmar. Sin conexión no se puede consultar el padrón: sólo consumidor
 * final.
 */
export function InvoiceReceiverChooser({
  receiver,
  emitter,
  isOnline,
  disabled,
  showLabel = true,
}: Props) {
  const labelId = useId();
  const listId = useId();
  const errorId = useId();
  const consumerLetter = consumerFinalLetter(emitter);
  const notice =
    receiver.choice === 'cuit' && !receiver.visibleCuitError
      ? describeTaxpayerLookup(receiver.lookup)
      : null;

  return (
    // El selector a todo el ancho y, sólo con CUIT, el campo abajo: a
    // consumidor final no queda ningún hueco.
    <div className="form-field exit-invoice-choice">
      {showLabel ? (
        <span className="form-label" id={labelId}>
          Factura
        </span>
      ) : null}
      <div
        className="exit-invoice-segments"
        role="radiogroup"
        aria-labelledby={showLabel ? labelId : undefined}
        aria-label={showLabel ? undefined : 'Receptor de la factura'}
      >
        {OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={receiver.choice === option.value}
            className={receiver.choice === option.value ? 'active' : undefined}
            onClick={() => receiver.setChoice(option.value)}
            disabled={disabled || (option.value === 'cuit' && !isOnline)}
          >
            {option.value === 'final'
              ? `${option.label} (Factura ${consumerLetter})`
              : option.label}
          </button>
        ))}
      </div>
      {!isOnline ? (
        <p className="exit-field-hint">
          Sin conexión no se consulta ARCA: se factura a consumidor final.
        </p>
      ) : null}
      {receiver.choice === 'cuit' ? (
        <>
          <input
            type="text"
            inputMode="numeric"
            placeholder="CUIT del cliente (con o sin guiones)"
            aria-label="CUIT del cliente"
            value={receiver.cuit}
            maxLength={13}
            list={receiver.suggestions.length > 0 ? listId : undefined}
            onChange={(e) => receiver.setCuit(e.target.value)}
            onBlur={receiver.markTouched}
            disabled={disabled}
            autoFocus
            autoComplete="off"
            aria-invalid={receiver.visibleCuitError ? true : undefined}
            aria-describedby={receiver.visibleCuitError ? errorId : undefined}
            className={
              receiver.visibleCuitError
                ? 'exit-invoice-cuit input-error'
                : 'exit-invoice-cuit'
            }
          />
          {receiver.suggestions.length > 0 ? (
            // Los CUIT ya facturados: el navegador los filtra mientras se
            // tipea y muestra la razón social al lado.
            <datalist id={listId}>
              {receiver.suggestions.map((s) => (
                <option
                  key={s.cuit}
                  value={formatCuit(s.cuit)}
                  label={s.razonSocial ?? undefined}
                />
              ))}
            </datalist>
          ) : null}
          {receiver.visibleCuitError ? (
            <p id={errorId} className="exit-field-hint is-error">
              {receiver.visibleCuitError}
            </p>
          ) : null}
          {notice ? (
            <p
              className={`exit-invoice-lookup exit-invoice-notice--${notice.tone}`}
              role="status"
            >
              {notice.text}
              {notice.detail ? (
                <span className="exit-invoice-detail">{notice.detail}</span>
              ) : null}
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
