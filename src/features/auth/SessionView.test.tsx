// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import type { Session } from '@supabase/supabase-js';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../lib/api/client';
import { localDb } from '../../lib/db/localDb';
import { cleanup, click, mount, pageText, waitForText } from '../../test/dom';
import { SessionView } from './SessionView';

const api = vi.hoisted(() => ({
  fetchMe: vi.fn(),
  listAdminParkings: vi.fn(),
  fetchEntityProfileSettings: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock('../../lib/api/auth', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchMe: api.fetchMe,
}));
vi.mock('../../lib/api/tenants', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  listAdminParkings: api.listAdminParkings,
}));
vi.mock('../../lib/api/entities', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchEntityProfileSettings: api.fetchEntityProfileSettings,
}));
vi.mock('../../lib/supabase/session', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  signOut: api.signOut,
}));
// El sync real sale a la red: acá alcanza con sus valores por defecto.
vi.mock('../../lib/sync/SyncContext', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  SyncProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('../camera/useCameraStatus', () => ({
  useCameraStatus: () => ({ state: 'idle' }),
}));

// Los paneles tienen sus propios tests: acá sólo importa a cuál se navega.
function stub(name: string) {
  return () => <section data-panel={name}>{`panel:${name}`}</section>;
}
vi.mock('../camera/CameraPanel', () => ({ CameraPanel: stub('camara') }));
vi.mock('../camera/AutoEntriesColumns', () => ({
  AutoEntriesColumns: stub('auto-entries'),
}));
vi.mock('../camera/CameraRulesBridge', () => ({
  CameraRulesBridge: () => null,
}));
vi.mock('../camera/CameraSettingsPanel', () => ({
  CameraSettingsPanel: stub('camera-settings'),
}));
vi.mock('../entries/EntryForm', () => ({ EntryForm: stub('entry-form') }));
vi.mock('../entries/ExitControls', () => ({ ExitControls: stub('exit') }));
vi.mock('../entries/ArrivalNotices', () => ({ ArrivalNotices: () => null }));
vi.mock('../entries/EntryHistoryPanel', () => ({
  EntryHistoryPanel: stub('historial'),
}));
vi.mock('../cash-session/CashSessionWorkspace', () => ({
  CashSessionWorkspace: stub('caja'),
}));
vi.mock('../cash-session/NoCashSessionScreen', () => ({
  NoCashSessionScreen: stub('sin-caja'),
}));
vi.mock('../printer/PrinterSettingsPanel', () => ({
  PrinterSettingsPanel: stub('impresora'),
}));
vi.mock('../reports/StatisticsPanel', () => ({
  StatisticsPanel: stub('estadisticas'),
}));
vi.mock('../reports/AuditPanel', () => ({ AuditPanel: stub('auditoria') }));
vi.mock('../reservations/ReservationsPanel', () => ({
  ReservationsPanel: stub('reservas'),
}));
vi.mock('../reservations/TodayReservationsEntry', () => ({
  TodayReservationsEntry: () => null,
}));
vi.mock('../rates/RatesPanel', () => ({ RatesPanel: stub('tarifas') }));
vi.mock('../payment-methods/PaymentMethodsPanel', () => ({
  PaymentMethodsPanel: stub('metodos'),
}));
vi.mock('../vehicles/VehiclesPanel', () => ({
  VehiclesPanel: stub('vehiculos'),
}));
vi.mock('../vehicle-types/VehicleTypesPanel', () => ({
  VehicleTypesPanel: stub('tipos'),
}));
vi.mock('../lpr-whitelist/LprWhitelistPanel', () => ({
  LprWhitelistPanel: stub('lista-blanca'),
}));
vi.mock('../clients/ClientsPanel', () => ({ ClientsPanel: stub('clientes') }));

const SESSION = {
  access_token: 'token',
  refresh_token: 'refresh',
  user: { id: 'user-1', email: 'duena@parkit.test', app_metadata: {} },
} as unknown as Session;

const ME = {
  id: 'user-1',
  email: 'duena@parkit.test',
  name: 'Dueña',
  role: 'user',
  memberships: [
    {
      tenantId: 'centro',
      tenantName: 'APEX Centro',
      tenantAddress: 'Av. Corrientes 1234',
      role: 'owner',
    },
    {
      tenantId: 'norte',
      tenantName: 'APEX Norte',
      tenantAddress: null,
      role: 'operator',
    },
  ],
};

function panel(): string | undefined {
  return document.querySelector<HTMLElement>('[data-panel]')?.dataset.panel;
}

describe('SessionView', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    localStorage.clear();
    api.fetchMe.mockResolvedValue(ME);
    api.listAdminParkings.mockResolvedValue([]);
    api.fetchEntityProfileSettings.mockResolvedValue({});
    api.signOut.mockResolvedValue(undefined);
    await localDb.cashSessions.put({
      id: 'caja-1',
      tenantId: 'centro',
      openedAt: new Date().toISOString(),
      openingCash: 0,
    } as never);
  });

  afterEach(async () => {
    await cleanup();
  });

  it('carga el perfil y abre el operativo de la sucursal', async () => {
    await mount(<SessionView session={SESSION} />);

    await waitForText('APEX Centro');
    expect(api.fetchMe).toHaveBeenCalledWith('token');
    expect(pageText()).toContain('Panel Operativo');
  });

  it('navega entre las secciones del menú', async () => {
    await mount(<SessionView session={SESSION} />);
    await waitForText('APEX Centro');

    const visited: (string | undefined)[] = [];
    for (const label of [
      'Cámara',
      'Historial',
      'Caja',
      'Estadísticas',
      'Auditoría',
      'Reservas',
    ]) {
      const item = [
        ...document.querySelectorAll<HTMLElement>('.sidebar-nav button'),
      ].find((button) => button.textContent?.trim().startsWith(label));
      if (!item) continue;
      await click(item);
      visited.push(panel());
    }

    expect(visited).toEqual(
      expect.arrayContaining(['camara', 'historial', 'caja', 'estadisticas']),
    );
  });

  it('abre las pantallas de configuración', async () => {
    await mount(<SessionView session={SESSION} />);
    await waitForText('APEX Centro');

    const opened: (string | undefined)[] = [];
    for (const label of [
      'Tarifas',
      'Métodos de pago',
      'Vehículos',
      'Tipos de vehículo',
      'Clientes',
      'Lista blanca',
      'Impresora',
    ]) {
      let item = [
        ...document.querySelectorAll<HTMLElement>('.sidebar-nav button'),
      ].find((button) => button.textContent?.trim() === label);
      if (!item) {
        // El grupo de configuración arranca plegado.
        const group = [
          ...document.querySelectorAll<HTMLElement>('.sidebar-nav button'),
        ].find((button) => /Configuración/.test(button.textContent ?? ''));
        if (group) await click(group);
        item = [
          ...document.querySelectorAll<HTMLElement>('.sidebar-nav button'),
        ].find((button) => button.textContent?.trim() === label);
      }
      if (!item) continue;
      await click(item);
      opened.push(panel());
    }

    expect(opened).toEqual(
      expect.arrayContaining(['tarifas', 'metodos', 'vehiculos', 'impresora']),
    );
  });

  it('colapsa el menú', async () => {
    await mount(<SessionView session={SESSION} />);
    await waitForText('APEX Centro');

    await click('Colapsar menú');

    expect(document.querySelector('[aria-label="Expandir menú"]')).toBeTruthy();
  });

  it('sin caja abierta pide abrir una', async () => {
    await localDb.cashSessions.clear();
    await mount(<SessionView session={SESSION} />);
    await waitForText('APEX Centro');

    expect(panel()).toBe('sin-caja');
  });

  it('sin servidor usa el perfil guardado en el equipo', async () => {
    await mount(<SessionView session={SESSION} />);
    await waitForText('APEX Centro');
    await cleanup();

    api.fetchMe.mockRejectedValue(new ApiError(503, 'x', null));
    await mount(<SessionView session={SESSION} />);

    await waitForText('Usamos el perfil guardado en este equipo.');
  });

  it('cierra la sesión', async () => {
    await mount(<SessionView session={SESSION} />);
    await waitForText('APEX Centro');

    await click('Salir');

    expect(api.signOut).toHaveBeenCalled();
  });
});
