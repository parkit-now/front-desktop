import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AuditRiskOverview } from './AuditRiskOverview';

const risk = {
  alerts: 32,
  possibleLoss: 82_523.46,
  undercharged: 75_433.46,
  reductions: 7_090,
  suggestedReductionRisk: 0,
  suspiciousDismissals: 50,
};

describe('AuditRiskOverview', () => {
  it('muestra los cuatro indicadores y el desglose web con centavos', () => {
    const html = renderToStaticMarkup(
      <AuditRiskOverview
        risk={risk}
        eventsLoading={false}
        eventsError={false}
        lprLoading={false}
        lprError={false}
      />,
    );
    expect(html.match(/class="report-audit-risk-card/g)).toHaveLength(4);
    for (const label of [
      'Pérdida posible',
      'Riesgo por horario/tarifa',
      'Descartes sospechosos',
      'Eventos auditables',
      'Desglose económico del período',
      'Cobros bajo sugerido',
      'Correcciones que bajan cobro',
      'Horario o tarifa reducida',
    ]) {
      expect(html).toContain(label);
    }
    expect(html).toContain('82.523,46');
  });

  it('no presenta ceros inventados cuando fallan las consultas', () => {
    const html = renderToStaticMarkup(
      <AuditRiskOverview
        risk={risk}
        eventsLoading={false}
        eventsError
        lprLoading={false}
        lprError
      />,
    );
    expect(html).not.toContain('82.523,46');
    expect(html).not.toContain('Descartes sospechosos</span><strong>50');
  });
});
