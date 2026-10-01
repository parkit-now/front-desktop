import { describe, expect, it } from 'vitest';
import {
  defaultReceiptTemplateSettings,
  isRequiredReceiptField,
  readReceiptTemplateSettings,
  resetReceiptTemplateSettings,
  writeReceiptTemplateSettings,
} from './receiptTemplate';

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

describe('receiptTemplate', () => {
  it('devuelve una plantilla no fiscal por defecto', () => {
    const template = readReceiptTemplateSettings(
      'tenant-1',
      new MemoryStorage(),
    );
    expect(template).toMatchObject({
      version: 1,
      tenantId: 'tenant-1',
      nonFiscalControlText: 'No válido como factura',
    });
    expect(template.fields[0]).toMatchObject({
      id: 'parkingName',
      visible: true,
    });
    expect(template.fields.some((field) => field.id === 'amount')).toBe(true);
  });

  it('guarda plantillas separadas por tenant', () => {
    const storage = new MemoryStorage();
    writeReceiptTemplateSettings(
      {
        ...defaultReceiptTemplateSettings('tenant-1'),
        grossIncomeText: 'IIBB: 1',
      },
      storage,
    );
    writeReceiptTemplateSettings(
      {
        ...defaultReceiptTemplateSettings('tenant-2'),
        grossIncomeText: 'IIBB: 2',
      },
      storage,
    );

    expect(
      readReceiptTemplateSettings('tenant-1', storage).grossIncomeText,
    ).toBe('IIBB: 1');
    expect(
      readReceiptTemplateSettings('tenant-2', storage).grossIncomeText,
    ).toBe('IIBB: 2');
  });

  it('no permite ocultar los campos obligatorios al normalizar', () => {
    const storage = new MemoryStorage();
    storage.setItem(
      'parkit.desktop.paymentReceiptTemplate:tenant-1',
      JSON.stringify({
        fields: [
          { id: 'amount', visible: false, fontSizePt: 8, emphasis: 'normal' },
        ],
      }),
    );

    const template = readReceiptTemplateSettings('tenant-1', storage);
    expect(template.fields[0]).toMatchObject({
      id: 'amount',
      visible: true,
      fontSizePt: 8,
    });
    expect(isRequiredReceiptField('plate')).toBe(true);
  });

  it('vuelve al default con storage corrupto', () => {
    const storage = new MemoryStorage();
    storage.setItem('parkit.desktop.paymentReceiptTemplate:tenant-1', '{{{');
    expect(readReceiptTemplateSettings('tenant-1', storage)).toEqual(
      defaultReceiptTemplateSettings('tenant-1'),
    );
  });

  it('restaura la plantilla default', () => {
    const storage = new MemoryStorage();
    const changed = defaultReceiptTemplateSettings('tenant-1');
    changed.fields[0].visible = false;
    writeReceiptTemplateSettings(changed, storage);

    expect(resetReceiptTemplateSettings('tenant-1', storage)).toEqual(
      defaultReceiptTemplateSettings('tenant-1'),
    );
  });
});
