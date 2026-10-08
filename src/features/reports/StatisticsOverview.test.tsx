import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { MetricsSummary, Revenue } from '../../lib/api/reports';
import { StatisticsOverview } from './StatisticsOverview';

const projection = {
  value: 780_600,
  openEntries: 44,
  historicalDays: 0,
  confidence: 'low',
} as const;
const summary = {
  occupancy: {
    occupied: 44,
    capacity: 80,
    free: 36,
    reservedHeld: 0,
    occupancyPct: 0.55,
  },
  today: { revenue: 263_800, vehiclesIn: 67, vehiclesOut: 23 },
  comparison: { previousDay: { revenueDeltaPct: 0.14 } },
  projections: {
    todayWithOpenEntries: projection,
    todayHistoricalForecast: projection,
    monthWithOpenEntries: projection,
    monthHistoricalForecast: projection,
  },
} as MetricsSummary;

describe('StatisticsOverview', () => {
  it('groups the primary KPIs and formats fractional comparison as a percentage', () => {
    const html = renderToStaticMarkup(
      <StatisticsOverview
        summary={summary}
        month={{ totals: { revenue: 2_033_817 } } as Revenue}
        summaryLoading={false}
        monthLoading={false}
        monthError={false}
      />,
    );
    expect(html.match(/class="report-overview-card"/g) ?? []).toHaveLength(3);
    expect(html).toContain('55%');
    expect(html).toContain('+14% frente a ayer');
    expect(html).toContain('Sin historial');
    expect(html).toContain('aria-label="Porcentaje de ocupación"');
  });

  it('does not show a fake occupancy percentage without configured capacity', () => {
    const html = renderToStaticMarkup(
      <StatisticsOverview
        summary={{
          ...summary,
          occupancy: {
            ...summary.occupancy,
            occupancyPct: null,
            capacity: 0,
            free: null,
          },
        }}
        summaryLoading={false}
        monthLoading={false}
        monthError={false}
      />,
    );
    expect(html).toContain('Capacidad sin configurar');
    expect(html).not.toContain('aria-label="Porcentaje de ocupación"');
  });

  it('shows an error instead of a zero monthly total when the query fails', () => {
    const html = renderToStaticMarkup(
      <StatisticsOverview
        summary={summary}
        summaryLoading={false}
        monthLoading={false}
        monthError
      />,
    );
    expect(html).toContain('No se pudo cargar la recaudación del mes.');
    expect(html).toContain('No disponible');
  });
});
