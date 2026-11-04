// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { EntryFormCore } from './EntryFormCore';

const mock = vi.hoisted(() => ({
  queryCall: 0,
  first: vi.fn(),
  types: undefined as undefined | Record<string, unknown>[],
  rates: [] as Record<string, unknown>[],
  catalog: undefined as undefined | Record<string, unknown>[],
}));

vi.mock('dexie-react-hooks', () => ({
  useLiveQuery: () => {
    const index = mock.queryCall++ % 3;
    return index === 0 ? mock.types : index === 1 ? mock.rates : mock.catalog;
  },
}));
vi.mock('../../lib/db/localDb', () => ({
  localDb: {
    plateProfiles: { get: mock.first },
    entries: {
      where: () => ({
        equals: () => ({ filter: () => ({ first: mock.first }) }),
      }),
    },
  },
}));
vi.mock('../../lib/network/NetworkContext', () => ({
  useNetwork: () => ({ isOnline: false }),
}));
vi.mock('../../lib/notifications/ToastProvider', () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

let root: Root;
let container: HTMLDivElement;

async function render() {
  mock.queryCall = 0;
  await act(() =>
    Promise.resolve(
      root.render(
        <EntryFormCore
          tenantId="tenant"
          accessToken="token"
          variant="auto"
          initialPlate="AB123CD"
        />,
      ),
    ),
  );
}

beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  mock.queryCall = 0;
  mock.types = undefined;
  mock.catalog = undefined;
  mock.rates = [];
  mock.first.mockReset();
  mock.first.mockResolvedValue({
    plate: 'AB123CD',
    vehicleBrand: 'Ford',
    vehicleModel: 'Ranger',
    vehicleTypeId: 'pickup',
  });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

it('no reemplaza un tipo eliminado por el del catálogo y conserva los otros campos válidos', async () => {
  mock.types = [{ id: 'pickup', name: 'Pickup', accepted: true }];
  mock.catalog = [{ brand: 'Ford', model: 'Ranger', typeId: 'pickup' }];
  mock.first.mockResolvedValue({
    vehicleBrand: 'Ford',
    vehicleModel: 'Ranger',
    vehicleTypeId: 'eliminado',
    color: 'COLOR VIEJO',
    rateId: 'eliminada',
  });
  await render();
  expect(
    container.querySelector<HTMLInputElement>('input[placeholder^="Vehículo"]')
      ?.value,
  ).toBe('Ford Ranger');
  expect(
    container.querySelector('.app-select-trigger')?.textContent,
  ).not.toContain('Pickup');
  expect(
    container.querySelector<HTMLInputElement>('input[placeholder^="Color"]')
      ?.value,
  ).toBe('');
});

it('no consulta el historial si no hay ficha o si fue eliminada', async () => {
  mock.types = [];
  mock.catalog = [{ brand: 'Ford', model: 'Ranger' }];
  mock.first.mockResolvedValue({
    vehicleBrand: 'Ford',
    vehicleModel: 'Ranger',
    deletedAt: new Date().toISOString(),
  });
  await render();
  expect(
    container.querySelector<HTMLInputElement>('input[placeholder^="Vehículo"]')
      ?.value,
  ).toBe('');
});

it('conserva lo que el operador escribe mientras espera la ficha', async () => {
  mock.types = [{ id: 'pickup', name: 'Pickup', accepted: true }];
  mock.catalog = [{ brand: 'Ford', model: 'Ranger', typeId: 'pickup' }];
  mock.rates = [{ id: 'rate', name: 'Hora', isActive: true }];
  let release!: (value: Record<string, unknown>) => void;
  mock.first.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  await render();
  const fill = async (placeholder: string, value: string) => {
    const input = container.querySelector<HTMLInputElement>(
      `input[placeholder^="${placeholder}"]`,
    )!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )!.set!.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await Promise.resolve();
    });
    return input;
  };
  const vehicle = await fill('Vehículo', 'Peugeot');
  const color = await fill('Color', 'ROJO');
  const rate = await fill('Tarifa', 'Manual');
  await act(async () => {
    release({
      vehicleBrand: 'Ford',
      vehicleModel: 'Ranger',
      color: 'NEGRO',
      rateId: 'rate',
    });
    await Promise.resolve();
  });
  expect(vehicle.value).toBe('Peugeot');
  expect(color.value).toBe('ROJO');
  expect(rate.value).toBe('Manual');
});

afterEach(async () => {
  await act(() => Promise.resolve(root.unmount()));
  container.remove();
});

it('espera tipos y catálogo antes de autocompletar una detección repetida', async () => {
  await render();
  expect(mock.first).not.toHaveBeenCalled();

  mock.types = [
    {
      id: 'pickup',
      tenantId: 'tenant',
      name: 'Pickup',
      category: 'pickup',
      accepted: true,
    },
  ];
  await render();
  expect(mock.first).not.toHaveBeenCalled();

  mock.catalog = [{ brand: 'Ford', model: 'Ranger', typeId: 'pickup' }];
  await render();

  expect(mock.first).toHaveBeenCalledTimes(1);
  expect(
    container.querySelector<HTMLInputElement>('input[placeholder^="Vehículo"]')
      ?.value,
  ).toBe('Ford Ranger');
  expect(container.querySelector('.app-select-trigger')?.textContent).toContain(
    'Pickup',
  );
});
