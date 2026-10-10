// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ArcaAccountDto } from '../../lib/api/arca';
import { InvoiceAccountSelector } from './InvoiceAccountSelector';

const primary: ArcaAccountDto = {
  id: 'primary',
  role: 'primary',
  status: 'linked',
  cuit: '20123456786',
  razonSocial: 'Emisor principal',
  ptoVta: 1,
  certAlias: 'parkit',
  environment: 'homologacion',
  fiscalDataEditable: true,
  ivaRate: 21,
};
const secondary: ArcaAccountDto = {
  ...primary,
  id: 'secondary',
  role: 'secondary',
  ptoVta: 2,
};
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

it.each([
  { accounts: [] },
  { accounts: [primary] },
  {
    accounts: [
      primary,
      { ...secondary, status: 'pending_certificate' as const },
    ],
  },
])(
  'no muestra selector si hay menos de dos cuentas configuradas: %j',
  ({ accounts }) => {
    const onChange = vi.fn();
    act(() =>
      root.render(
        <InvoiceAccountSelector
          accounts={accounts}
          value="primary"
          onChange={onChange}
        />,
      ),
    );
    expect(container.querySelector('.entry-invoice-account')).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  },
);

it('permite elegir cuando primaria y secundaria están configuradas', () => {
  act(() =>
    root.render(
      <InvoiceAccountSelector
        accounts={[primary, secondary]}
        value="primary"
        onChange={vi.fn()}
      />,
    ),
  );
  expect(container.querySelector('.entry-invoice-account')).not.toBeNull();
});
