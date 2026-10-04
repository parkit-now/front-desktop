import { describe, expect, it } from 'vitest';
import {
  defaultTicketTemplateSettings,
  fontSizeToOption,
  linkVehicleFields,
  normalizeTicketTemplateSettings,
  readTicketTemplateSettings,
  resetTicketTemplateSettings,
  writeTicketTemplateSettings,
} from './ticketTemplate';

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

describe('ticketTemplate', () => {
  it('devuelve una plantilla compacta por defecto', () => {
    const template = readTicketTemplateSettings(
      'tenant-1',
      new MemoryStorage(),
    );
    expect(template).toMatchObject({
      version: 1,
      tenantId: 'tenant-1',
      nonFiscalControlText: 'Control no fiscal',
    });
    expect(template.fields[0]).toMatchObject({
      id: 'parkingName',
      visible: true,
    });
    expect(template.fields.some((field) => field.id === 'ticketNumber')).toBe(
      true,
    );
  });

  it('guarda plantillas separadas por tenant', () => {
    const storage = new MemoryStorage();
    const first = defaultTicketTemplateSettings('tenant-1');
    const second = defaultTicketTemplateSettings('tenant-2');
    writeTicketTemplateSettings(
      { ...first, grossIncomeText: 'IIBB: 1' },
      storage,
    );
    writeTicketTemplateSettings(
      { ...second, grossIncomeText: 'IIBB: 2' },
      storage,
    );

    expect(
      readTicketTemplateSettings('tenant-1', storage).grossIncomeText,
    ).toBe('IIBB: 1');
    expect(
      readTicketTemplateSettings('tenant-2', storage).grossIncomeText,
    ).toBe('IIBB: 2');
  });

  it('normaliza campos guardados y agrega campos nuevos que falten', () => {
    const storage = new MemoryStorage();
    storage.setItem(
      'parkit.desktop.ticketTemplate:tenant-1',
      JSON.stringify({
        fields: [
          { id: 'plate', visible: false, fontSizePt: 18, emphasis: 'bold' },
        ],
      }),
    );

    const template = readTicketTemplateSettings('tenant-1', storage);
    expect(template.fields[0]).toMatchObject({
      id: 'plate',
      visible: false,
      fontSizePt: 18,
      emphasis: 'bold',
    });
    expect(template.fields.some((field) => field.id === 'parkingName')).toBe(
      true,
    );
  });

  it('vuelve al default con storage corrupto', () => {
    const storage = new MemoryStorage();
    storage.setItem('parkit.desktop.ticketTemplate:tenant-1', '{{{');
    expect(readTicketTemplateSettings('tenant-1', storage)).toEqual(
      defaultTicketTemplateSettings('tenant-1'),
    );
  });

  it('restaura la plantilla default', () => {
    const storage = new MemoryStorage();
    const changed = defaultTicketTemplateSettings('tenant-1');
    changed.fields[0].visible = false;
    writeTicketTemplateSettings(changed, storage);

    expect(resetTicketTemplateSettings('tenant-1', storage)).toEqual(
      defaultTicketTemplateSettings('tenant-1'),
    );
  });

  it('mapea tamaños libres al selector más cercano', () => {
    expect(fontSizeToOption(8)).toBe('small');
    expect(fontSizeToOption(12)).toBe('large');
    expect(fontSizeToOption(24)).toBe('hero');
  });

  it('el modelo copia la configuración de la marca y va detrás de ella', () => {
    const template = normalizeTicketTemplateSettings('tenant-1', {
      fields: [
        { id: 'vehicleModel', visible: true, fontSizePt: 13, emphasis: 'bold' },
        { id: 'plate' },
        {
          id: 'vehicleBrand',
          visible: false,
          fontSizePt: 8,
          emphasis: 'normal',
        },
      ],
    });
    const ids = template.fields.map((field) => field.id);
    expect(ids.slice(0, 3)).toEqual(['plate', 'vehicleBrand', 'vehicleModel']);
    expect(template.fields[2]).toMatchObject({
      visible: false,
      fontSizePt: 8,
      emphasis: 'normal',
    });
  });

  it('mover la marca arrastra al modelo', () => {
    const fields = defaultTicketTemplateSettings('t').fields;
    const brand = fields.find((field) => field.id === 'vehicleBrand')!;
    const moved = [brand, ...fields.filter((field) => field !== brand)];
    const ids = linkVehicleFields(moved).map((field) => field.id);
    expect(ids.slice(0, 2)).toEqual(['vehicleBrand', 'vehicleModel']);
  });
});
