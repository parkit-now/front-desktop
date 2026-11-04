// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { localDb } from '../../lib/db/localDb';
import { setEnqueueUserId } from '../../lib/sync/enqueue';
import {
  button,
  change,
  cleanup,
  click,
  mount,
  pageText,
  settle,
} from '../../test/dom';
import { EntryFormCore, type EntryFormVariant } from './EntryFormCore';

const mock = vi.hoisted(() => ({
  online: false,
  create: vi.fn(),
  print: vi.fn(),
  registered: vi.fn(),
}));
vi.mock('../../lib/network/NetworkContext', () => ({
  useNetwork: () => ({ isOnline: mock.online }),
}));
vi.mock('../../lib/api/entries', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  createEntry: mock.create,
}));
vi.mock('../../lib/print/printTicket', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  printEntryTicket: mock.print,
}));
vi.mock('./useReservationMatch', () => ({
  useReservationMatch: () => ({ match: null, upcoming: null }),
}));

const PRINT = 'Registrar ingreso e imprimir ticket';
const NO_PRINT = 'Registrar sin imprimir ticket';
const metadata = {
  tenantId: 'tenant',
  version: 1,
  syncSeq: 1,
  createdAt: '2026-11-04T10:00:00Z',
  updatedAt: '2026-11-04T10:00:00Z',
};

function input(placeholder: string) {
  return document.querySelector<HTMLInputElement>(
    `input[placeholder^="${placeholder}"]`,
  )!;
}

async function selectSuggestion(placeholder: string, value: string) {
  await change(input(placeholder), value);
  const option = [
    ...document.querySelectorAll<HTMLElement>('.vehicle-suggestion'),
  ].find((item) => item.textContent?.trim() === value)!;
  expect(option).toBeTruthy();
  await act(() =>
    Promise.resolve(
      option.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })),
    ),
  );
  await settle();
}

async function render(variant: EntryFormVariant) {
  return mount(
    <EntryFormCore
      tenantId="tenant"
      accessToken="token"
      variant={variant}
      initialPlate={variant === 'auto' ? 'ABC123' : undefined}
      onRegistered={mock.registered}
    />,
  );
}

async function fillValid() {
  await change(input('Patente'), 'ABC123');
  await selectSuggestion('Vehículo', 'Gol');
  await selectSuggestion('Color', 'NEGRO');
  await selectSuggestion('Tarifa', 'Hora');
}

async function expectNoRegistration() {
  expect(await localDb.entries.count()).toBe(0);
  expect(await localDb.pendingOps.count()).toBe(0);
  expect(mock.create).not.toHaveBeenCalled();
  expect(mock.print).not.toHaveBeenCalled();
  expect(mock.registered).not.toHaveBeenCalled();
}

describe.each(['manual', 'auto'] as const)(
  'validación de ingreso %s',
  (variant) => {
    beforeEach(async () => {
      vi.clearAllMocks();
      mock.online = false;
      mock.print.mockResolvedValue({ ok: true });
      setEnqueueUserId('operator');
      await localDb.vehicleTypes.put({
        ...metadata,
        id: 'auto',
        name: 'Auto',
        accepted: true,
      });
      await localDb.vehicles.put({
        ...metadata,
        id: 'gol',
        brand: 'Volkswagen',
        model: 'Gol',
        typeId: 'auto',
      });
      await localDb.rates.put({
        ...metadata,
        id: 'hora',
        name: 'Hora',
        isActive: true,
        hourPriceArs: '1000',
        stayPriceArs: '5000',
        fractionPriceArs: '500',
        mediaEstadiaPriceArs: '2500',
        autoFractionPrice: false,
      });
      await localDb.cashSessions.put({
        ...metadata,
        id: 'cash',
        openedAt: metadata.createdAt,
        openingCash: 0,
      });
    });

    afterEach(async () => {
      await cleanup();
      setEnqueueUserId(null);
    });

    it.each([PRINT, NO_PRINT])(
      'marca todos los faltantes al intentar %s, sin guardar ni imprimir',
      async (action) => {
        const container = await render(variant);
        const submit = button(action) as HTMLButtonElement;
        expect(submit.getAttribute('aria-disabled')).toBe('true');
        expect(submit.disabled).toBe(false);
        expect(container.querySelectorAll('.input-error')).toHaveLength(0);

        await click(submit);

        for (const placeholder of ['Vehículo', 'Color', 'Tarifa']) {
          expect(input(placeholder).classList.contains('input-error')).toBe(
            true,
          );
          expect(input(placeholder).getAttribute('aria-invalid')).toBe('true');
        }
        expect(input('Patente').classList.contains('input-error')).toBe(
          variant === 'manual',
        );
        expect(document.activeElement).toBe(
          input(variant === 'manual' ? 'Patente' : 'Vehículo'),
        );
        expect(input('Cochera').classList.contains('input-error')).toBe(false);
        expect(input('Notas').classList.contains('input-error')).toBe(false);
        await expectNoRegistration();
      },
    );

    it('solo marca la tarifa pendiente y elimina el error al seleccionarla', async () => {
      await render(variant);
      await fillValid();
      await change(input('Tarifa'), '');
      await click(PRINT);
      expect(document.querySelectorAll('.input-error')).toHaveLength(1);
      expect(input('Tarifa').getAttribute('aria-invalid')).toBe('true');
      expect(document.activeElement).toBe(input('Tarifa'));
      await expectNoRegistration();

      await selectSuggestion('Tarifa', 'Hora');
      expect(document.querySelectorAll('.input-error')).toHaveLength(0);
      expect(button(PRINT).getAttribute('aria-disabled')).toBe('false');
    });

    it('rechaza textos sin seleccionar y el tipo faltante de un vehículo libre', async () => {
      await render(variant);
      await change(input('Patente'), 'ABC123');
      await change(input('Vehículo'), 'Gol');
      await change(input('Color'), 'NEGRO');
      await change(input('Tarifa'), 'Hora');
      await click(NO_PRINT);
      expect(pageText()).toContain('Seleccioná un vehículo de la lista');
      expect(pageText()).toContain('Seleccioná un color de la lista');
      expect(pageText()).toContain('Seleccioná una tarifa de la lista');
      await expectNoRegistration();

      await change(input('Vehículo'), 'Moto sin catálogo');
      await selectSuggestion('Color', 'NEGRO');
      await selectSuggestion('Tarifa', 'Hora');
      await click(PRINT);
      expect(pageText()).toContain('Elegí el tipo de vehículo');
      expect(document.querySelector('.app-select-error')).toBeTruthy();
      expect(document.activeElement).toBe(
        document.querySelector('[role="combobox"]'),
      );
      await expectNoRegistration();
    });

    it.each([PRINT, NO_PRINT])(
      'permite %s después de corregir los campos, también offline',
      async (action) => {
        await render(variant);
        await click(action);
        await fillValid();
        await click(action);
        await vi.waitFor(async () =>
          expect(await localDb.entries.count()).toBe(1),
        );
        const saved = await localDb.entries.toArray();
        expect(saved[0]).toMatchObject({
          plate: 'ABC123',
          vehicleBrand: 'Volkswagen',
          vehicleModel: 'Gol',
          color: 'NEGRO',
          rateId: 'hora',
        });
        expect(await localDb.pendingOps.count()).toBe(1);
        expect(mock.print).toHaveBeenCalledTimes(action === PRINT ? 1 : 0);
        expect(mock.create).not.toHaveBeenCalled();
        if (variant === 'auto') expect(mock.registered).toHaveBeenCalledOnce();
      },
    );

    it('valida también un envío desde el teclado sin guardar campos incompletos', async () => {
      const container = await render(variant);
      await act(() =>
        Promise.resolve(
          container
            .querySelector('form')!
            .dispatchEvent(
              new Event('submit', { bubbles: true, cancelable: true }),
            ),
        ),
      );
      expect(input('Color').getAttribute('aria-invalid')).toBe('true');
      await expectNoRegistration();
    });

    it('bloquea ambos botones durante el guardado y evita envíos repetidos', async () => {
      mock.online = true;
      let reject!: (error: Error) => void;
      mock.create.mockImplementationOnce(
        () =>
          new Promise((_, rejectPromise) => {
            reject = rejectPromise;
          }),
      );
      const container = await render(variant);
      await fillValid();
      await click(NO_PRINT);
      await vi.waitFor(() => expect(mock.create).toHaveBeenCalledOnce());
      expect((button(PRINT) as HTMLButtonElement).disabled).toBe(true);
      expect((button(NO_PRINT) as HTMLButtonElement).disabled).toBe(true);
      await click(PRINT);
      await click(NO_PRINT);
      await act(() =>
        Promise.resolve(
          container
            .querySelector('form')!
            .dispatchEvent(
              new Event('submit', { bubbles: true, cancelable: true }),
            ),
        ),
      );
      expect(mock.create).toHaveBeenCalledOnce();
      await act(() => Promise.resolve(reject(new Error('simulated failure'))));
      await settle();
      expect((button(PRINT) as HTMLButtonElement).disabled).toBe(false);
      expect((button(NO_PRINT) as HTMLButtonElement).disabled).toBe(false);
      expect(mock.print).not.toHaveBeenCalled();
    });

    it('conserva el bloqueo de una patente con ingreso activo', async () => {
      await render(variant);
      await fillValid();
      await localDb.entries.put({
        ...metadata,
        id: 'existing',
        plate: 'ABC123',
        enteredAt: metadata.createdAt,
      });
      await act(() =>
        Promise.resolve(
          input('Patente').dispatchEvent(
            new FocusEvent('focusout', { bubbles: true }),
          ),
        ),
      );
      await settle();
      expect(button(NO_PRINT).getAttribute('aria-disabled')).toBe('true');
      await click(NO_PRINT);
      expect(input('Patente').classList.contains('input-error')).toBe(true);
      expect(document.activeElement).toBe(input('Patente'));
      expect(await localDb.entries.count()).toBe(1);
      expect(await localDb.pendingOps.count()).toBe(0);
      expect(mock.print).not.toHaveBeenCalled();
    });
  },
);
