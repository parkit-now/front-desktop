import { formatArs } from '../../lib/format/argentina';

export type InvoicePaymentOption = {
  id: string;
  name: string;
  amount: number;
  disabled?: boolean;
};

export function eligibleInvoicePaymentIds(
  options: InvoicePaymentOption[],
): string[] {
  return options
    .filter((option) => !option.disabled && option.amount > 0)
    .map((option) => option.id);
}

export function InvoicePaymentSelector({
  options,
  selectedIds,
  onChange,
  disabled = false,
}: {
  options: InvoicePaymentOption[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
}) {
  const selected = new Set(selectedIds);
  const amount = options.reduce(
    (sum, option) => sum + (selected.has(option.id) ? option.amount : 0),
    0,
  );
  const total = options.reduce((sum, option) => sum + option.amount, 0);

  return (
    <fieldset className="invoice-payment-selector" disabled={disabled}>
      <legend>Pagos a incluir en la factura</legend>
      <div className="invoice-payment-selector__list">
        {options.map((option) => {
          const checked = selected.has(option.id);
          return (
            <label className="invoice-payment-selector__row" key={option.id}>
              <input
                type="checkbox"
                checked={checked}
                disabled={
                  option.disabled || (checked && selectedIds.length === 1)
                }
                onChange={() =>
                  onChange(
                    checked
                      ? selectedIds.filter((id) => id !== option.id)
                      : [...selectedIds, option.id],
                  )
                }
              />
              <span className="invoice-payment-selector__name">
                {option.name}
                {option.disabled ? <small>No facturable</small> : null}
              </span>
              <strong>{formatArs(option.amount)}</strong>
            </label>
          );
        })}
      </div>
      <div className="invoice-payment-selector__total">
        <span>A facturar</span>
        <strong>{formatArs(amount)}</strong>
        <small>de {formatArs(total)} cobrados</small>
      </div>
    </fieldset>
  );
}
