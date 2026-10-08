import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ReportMetric, ReportTableLoading } from './ReportLoading';

describe('report loading states', () => {
  it('keeps the metric label but hides its value until loaded', () => {
    const loading = renderToStaticMarkup(
      <ReportMetric label="Cobrado hoy" value="$ 5.000" loading />,
    );
    expect(loading).toContain('aria-busy="true"');
    expect(loading).toContain('Cargando cobrado hoy');
    expect(loading).not.toContain('$ 5.000');

    const loaded = renderToStaticMarkup(
      <ReportMetric label="Cobrado hoy" value="$ 5.000" />,
    );
    expect(loaded).toContain('$ 5.000');
    expect(loaded).toContain('aria-busy="false"');
  });

  it('keeps a stable table structure without exposing placeholder rows as data', () => {
    const html = renderToStaticMarkup(
      <ReportTableLoading columns={['Fecha', 'Actor']} rows={3} />,
    );
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-hidden="true"');
    expect(html.match(/<tr>/g) ?? []).toHaveLength(4);
  });
});
