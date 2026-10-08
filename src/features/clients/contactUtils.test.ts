import { describe, expect, it } from 'vitest';
import type { LocalClient } from '../../lib/db/localDb';
import { clientForInvoice, whatsappUrl } from './contactUtils';

const client = (input: Partial<LocalClient>): LocalClient => ({
  id: 'one',
  tenantId: 'tenant',
  plates: ['IAG574'],
  cuit: '20427205208',
  name: 'Ian',
  email: 'ian@example.com',
  phone: '+5491123456789',
  version: 1,
  syncSeq: 1,
  createdAt: '',
  updatedAt: '',
  deletedAt: null,
  ...input,
});

describe('contacto de factura', () => {
  it('usa el receptor CUIT aunque la patente este asociada a otro cliente', () => {
    const rows = [
      client({ id: 'old', cuit: '30712345671' }),
      client({ id: 'receiver', plates: ['ZZZ999'] }),
    ];
    expect(clientForInvoice(rows, 'IAG574', '20427205208')?.id).toBe(
      'receiver',
    );
    expect(clientForInvoice(rows, 'IAG574', '99999999999')).toBeNull();
  });
  it('usa la patente normalizada para consumidor final e ignora archivados', () => {
    expect(
      clientForInvoice(
        [client({ deletedAt: '2026-10-07' }), client({ id: 'active' })],
        'iag-574',
      )?.id,
    ).toBe('active');
  });
  it('solo habilita WhatsApp con prefijo internacional', () => {
    expect(whatsappUrl('+54 9 11 2345-6789')).toBe(
      'https://wa.me/5491123456789',
    );
    expect(whatsappUrl('11 2345 6789')).toBeNull();
  });
});
