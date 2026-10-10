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
    vehicleTypeId: 'old-type',
  });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
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
