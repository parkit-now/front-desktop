// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../lib/api/client';
import { localDb } from '../../lib/db/localDb';
import {
  choose,
  cleanup,
  click,
  mount,
  pageText,
  waitForText,
} from '../../test/dom';
import { AuditPanel } from './AuditPanel';
import { StatisticsPanel } from './StatisticsPanel';

const http = vi.hoisted(() => ({ request: vi.fn() }));

vi.mock('../../lib/api/client', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  apiRequest: http.request,
}));

const NOW = new Date().toISOString();

function bucket(key: string, revenue: number, vehiclesIn: number) {
  return {
    key,
    from: `${key}T03:00:00.000Z`,
    to: `${key}T03:00:00.000Z`,
    revenue,
    reservationRevenue: 0,
    vehiclesIn,
    vehiclesOut: vehiclesIn,
  };
}

const projection = {
  value: 1000,
  openEntries: 1,
  historicalDays: 10,
  confidence: 'low',
};

const day = {
  day: NOW.slice(0, 10),
  revenue: 8000,
  reservationRevenue: 0,
  revenueDeltaPct: 10,
  vehiclesIn: 4,
  vehiclesInDeltaPct: 5,
  vehiclesOut: 4,
};

/** Respuestas por endpoint de métricas y auditoría. */
function respond({ path }: { path: string }) {
  const url = new URL(path, 'http://local');
  const route = url.pathname.replace('/tenants/tenant', '');
  switch (route) {
    case '/metrics/summary':
      return Promise.resolve({
        day: day.day,
        generatedAt: NOW,
        tz: 'America/Argentina/Buenos_Aires',
        occupancy: {
          capacity: 40,
          free: 30,
          occupied: 10,
          occupancyPct: 25,
          reservedHeld: 0,
        },
        today: day,
        comparison: { previousDay: day, previousWeek: day },
        alerts: { pendingLprEvents: 0 },
        projections: {
          todayWithOpenEntries: projection,
          todayHistoricalForecast: projection,
          monthWithOpenEntries: projection,
          monthHistoricalForecast: projection,
        },
      });
    case '/metrics/revenue':
      return Promise.resolve({
        buckets: [
          bucket('2026-10-05', 12000, 8),
          bucket('2026-10-06', 18000, 11),
        ],
        totals: bucket('total', 30000, 19),
        currency: 'ARS',
        from: NOW,
        to: NOW,
        granularity: url.searchParams.get('granularity') ?? 'day',
        revenueSource: 'paymentTransactions',
        tz: 'America/Argentina/Buenos_Aires',
      });
    case '/metrics/revenue/by-payment-method':
      return Promise.resolve({
        allocated: 30000,
        unallocated: 0,
        total: 30000,
        currency: 'ARS',
        from: NOW,
        to: NOW,
        methods: [
          {
            name: 'Efectivo',
            amount: 30000,
            count: 19,
            share: 1,
            kind: 'payment',
          },
        ],
      });
    case '/metrics/by-vehicle-category':
      return Promise.resolve({
        categories: [{ category: 'car', revenue: 30000, share: 1, stays: 19 }],
        currency: 'ARS',
        from: NOW,
        to: NOW,
        totalRevenue: 30000,
        totalStays: 19,
      });
    case '/metrics/top-plates':
      return Promise.resolve({
        currency: 'ARS',
        from: NOW,
        to: NOW,
        orderBy: url.searchParams.get('orderBy') ?? 'revenue',
        items: [
          {
            plate: 'AB123CD',
            revenue: 9000,
            visits: 4,
            totalMinutes: 600,
            averageMinutes: 150,
          },
        ],
      });
    case '/audit':
      return Promise.resolve({
        items: [
          {
            id: 'a-1',
            action: 'entry.undercharged',
            actorName: 'operador@parkit.test',
            createdAt: NOW,
            entityId: 'entry-1',
            entityType: 'entry',
            severity: 'warn',
            metadata: {
              plate: 'DEF456',
              suggestedAmount: 2000,
              chargedAmount: 1500,
              delta: 500,
            },
          },
          {
            id: 'a-2',
            action: 'entry.corrected',
            actorName: 'operador@parkit.test',
            createdAt: NOW,
            entityId: 'entry-2',
            entityType: 'entry',
            severity: 'warn',
            metadata: {
              reason: 'Error de tipeo',
              changedFields: ['plate'],
              before: { plate: 'ABC123' },
              after: { plate: 'XYZ999' },
            },
          },
        ],
        total: 2,
        page: 1,
        pageSize: 100,
      });
    case '/lpr-events':
      return Promise.resolve({
        items: [
          {
            id: 'lpr-1',
            cameraId: 'cam',
            candidates: [],
            confidence: 0.95,
            createdAt: NOW,
            firstSeenAt: NOW,
            lastSeenAt: NOW,
            formatType: 'argentina_mercosur',
            formatValid: true,
            location: 'Entrada',
            normalizedText: 'LP123RR',
            qualityStatus: 'valid_high',
            status: 'dismissed',
            syncSeq: 1,
            tenantId: 'tenant',
            updatedAt: NOW,
            version: 1,
          },
        ],
        total: 1,
        page: 1,
        pageSize: 100,
      });
    default:
      return Promise.resolve({ url: 'https://storage.test/img.jpg' });
  }
}

function paths() {
  return http.request.mock.calls.map(
    ([call]) => (call as { path: string }).path,
  );
}

beforeEach(async () => {
  vi.clearAllMocks();
  localStorage.clear();
  http.request.mockImplementation(respond);
  await localDb.paymentMethods.put({
    id: 'efectivo',
    tenantId: 'tenant',
    name: 'Efectivo',
    enabled: true,
    isDefault: true,
    isSystem: true,
    syncSeq: 1,
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
  });
  await localDb.vehicleCategories.put({
    code: 'car',
    label: 'Auto',
    sortOrder: 1,
    reservable: true,
  });
  await localDb.cashSessions.put({
    id: 'caja-1',
    tenantId: 'tenant',
    openedAt: NOW,
    openingCash: 0,
  } as never);
});

afterEach(async () => {
  await cleanup();
});

describe('StatisticsPanel', () => {
  it('muestra la serie, los medios de pago y las patentes top', async () => {
    await mount(<StatisticsPanel tenantId="tenant" bearer="token" />);

    await waitForText('AB123CD');
    expect(pageText()).toContain('Por medio de pago');
    expect(paths().some((path) => path.includes('/metrics/revenue?'))).toBe(
      true,
    );
  });

  it('cambia el período, los filtros y la agrupación', async () => {
    await mount(<StatisticsPanel tenantId="tenant" bearer="token" />);
    await waitForText('AB123CD');

    await click('30 días');
    await click('Hoy');
    await choose('Medio de pago', 'Efectivo');
    await choose('Categoría', 'Auto');

    const revenue = paths().filter((path) =>
      path.includes('/metrics/revenue?'),
    );
    expect(revenue.at(-1)).toContain('paymentMethod=Efectivo');
    expect(revenue.at(-1)).toContain('vehicleCategory=car');

    await choose('Agrupar', 'Por día de semana');
    expect(
      document.querySelector('[aria-label="Cálculo por día de semana"]'),
    ).toBeTruthy();
  });

  it('recorta por caja', async () => {
    await mount(<StatisticsPanel tenantId="tenant" bearer="token" />);
    await waitForText('AB123CD');

    await click('Por caja');
    expect(pageText()).toContain('Elegí una caja para ver sus estadísticas.');
    await choose('Caja', /abierta$/);

    await waitForText('AB123CD');
    expect(paths().some((path) => path.includes('cashSessionId=caja-1'))).toBe(
      true,
    );
  });

  it('avisa si no se pudo cargar', async () => {
    http.request.mockRejectedValue(new ApiError(500, 'boom', null));
    await mount(<StatisticsPanel tenantId="tenant" bearer="token" />);

    await waitForText('El servidor no responde.');
  });

  it('se actualiza a mano', async () => {
    await mount(<StatisticsPanel tenantId="tenant" bearer="token" />);
    await waitForText('AB123CD');
    const before = http.request.mock.calls.length;

    await click('Actualizar estadísticas');

    expect(http.request.mock.calls.length).toBeGreaterThan(before);
  });
});

describe('AuditPanel', () => {
  function render() {
    return mount(
      <AuditPanel
        tenantId="tenant"
        bearer="token"
        userId="user"
        parkingName="APEX"
      />,
    );
  }

  it('lista los eventos del período', async () => {
    await render();

    await waitForText('DEF456');
    expect(pageText()).toContain('XYZ999');
  });

  it('abre el detalle de un evento', async () => {
    await render();
    await waitForText('DEF456');

    const row = [...document.querySelectorAll('tbody tr')].find((tr) =>
      tr.textContent?.includes('DEF456'),
    ) as HTMLElement;
    await click(row);

    expect(
      document.querySelector('[aria-label="Detalle de auditoría"]'),
    ).toBeTruthy();
    expect(pageText()).toContain('Impacto monetario');
    await click('Cerrar detalle');
  });

  it('muestra las patentes descartadas en su pestaña', async () => {
    await render();
    await waitForText('DEF456');

    const tabs = document.querySelectorAll<HTMLElement>('[role="tab"]');
    await click(tabs[tabs.length - 1]);

    await waitForText('LP123RR');
    await click('Actualizar descartes');
  });

  it('avisa si no se pudo cargar la auditoría', async () => {
    http.request.mockRejectedValue(new ApiError(500, 'boom', null));
    await render();

    await waitForText('No se pudieron cargar los eventos');
  });
});
