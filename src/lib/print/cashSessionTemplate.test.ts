import { describe, expect, it } from 'vitest';
import {
  defaultCashSessionTemplateSettings,
  normalizeCashSessionTemplateSettings,
  readCashSessionTemplateSettings,
  resetCashSessionTemplateSettings,
  writeCashSessionTemplateSettings,
} from './cashSessionTemplate';

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

describe('plantilla del cierre de caja', () => {
  it('guarda visibilidad, orden y tipografía por estacionamiento', () => {
    const storage = new MemoryStorage();
    const template = defaultCashSessionTemplateSettings('apex');
    const notes = template.fields.find((field) => field.id === 'notes')!;
    const next = {
      ...template,
      fields: [
        { ...notes, visible: false, fontSizePt: 12, emphasis: 'bold' as const },
        ...template.fields.filter((field) => field.id !== 'notes'),
      ],
    };
    writeCashSessionTemplateSettings(next, storage);

    expect(readCashSessionTemplateSettings('apex', storage).fields[0]).toEqual(
      next.fields[0],
    );
    expect(readCashSessionTemplateSettings('otro', storage)).toEqual(
      defaultCashSessionTemplateSettings('otro'),
    );
    expect(resetCashSessionTemplateSettings('apex', storage)).toEqual(template);
  });

  it('mantiene campos esenciales y completa plantillas antiguas', () => {
    const normalized = normalizeCashSessionTemplateSettings('apex', {
      fields: [
        { id: 'grandTotal', visible: false, fontSizePt: 18 },
        { id: 'notes', visible: false },
        { id: 'grandTotal', visible: false },
      ],
    });
    expect(normalized.fields[0]).toMatchObject({
      id: 'grandTotal',
      visible: true,
      fontSizePt: 18,
    });
    expect(normalized.fields[1]).toMatchObject({ id: 'notes', visible: false });
    expect(normalized.fields).toHaveLength(
      defaultCashSessionTemplateSettings('apex').fields.length,
    );
  });

  it('recupera valores por defecto si el almacenamiento está corrupto', () => {
    const storage = new MemoryStorage();
    storage.setItem('parkit.desktop.cashSessionTemplate:apex', '{');
    expect(readCashSessionTemplateSettings('apex', storage)).toEqual(
      defaultCashSessionTemplateSettings('apex'),
    );
  });
});
