import type { ArcaAccountDto } from '../../lib/api/arca';
import { AppSelect } from '../../lib/ui/AppSelect';
import { formatCuit } from './invoiceUtils';

export function invoiceAccountLabel(account: ArcaAccountDto): string {
  return `${account.role === 'secondary' ? 'Secundaria' : 'Primaria'} · ${account.razonSocial ?? formatCuit(account.cuit)} · CUIT ${formatCuit(account.cuit)} · PV ${account.ptoVta ?? '—'}`;
}

export function InvoiceAccountSelector({
  accounts,
  value,
  onChange,
  disabled = false,
}: {
  accounts: readonly ArcaAccountDto[];
  value?: string;
  onChange: (id: string) => void;
  disabled?: boolean;
}) {
  const selectableAccounts = accounts.filter((item) =>
    ['linked', 'cert_expired'].includes(item.status),
  );
  if (selectableAccounts.length < 2) return null;
  const account = accounts.find((item) => item.id === value);
  return (
    <label
      className="entry-invoice-account"
      title={account ? invoiceAccountLabel(account) : 'Cuenta no disponible'}
    >
      <span className="form-label">Cuenta de facturación</span>
      <AppSelect
        value={value ?? ''}
        disabled={disabled}
        onChange={onChange}
        placeholder="Cuenta no disponible"
        options={selectableAccounts.map((item) => ({
          value: item.id,
          label: `${item.role === 'secondary' ? 'Secundaria' : 'Primaria'} · ${item.razonSocial ?? formatCuit(item.cuit)}`,
        }))}
      />
      {account ? (
        <small>
          CUIT {formatCuit(account.cuit)} · Punto de venta{' '}
          {account.ptoVta ?? '—'}
          {account.status === 'cert_expired' ? ' · Certificado vencido' : ''}
        </small>
      ) : null}
    </label>
  );
}
