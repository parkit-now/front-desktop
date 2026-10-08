import type { ReactNode } from 'react';
import { CarFront, DollarSign, Shield, TrendingUp } from 'lucide-react';
import { money } from './reportUtils';
import type { riskTotals } from './auditReportUtils';

type Risk = ReturnType<typeof riskTotals>;

function Metric({
  icon,
  label,
  value,
  tone,
  loading,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  tone?: 'warning' | 'danger';
  loading: boolean;
}) {
  return (
    <div
      className={`report-audit-risk-card${tone ? ` report-audit-risk-card--${tone}` : ''}`}
      aria-busy={loading}
    >
      <span className="report-audit-risk-icon" aria-hidden="true">
        {icon}
      </span>
      <div>
        <span className="report-audit-risk-label">{label}</span>
        {loading ? (
          <span
            className="report-skeleton report-skeleton--value"
            aria-hidden="true"
          />
        ) : (
          <strong>{value}</strong>
        )}
      </div>
    </div>
  );
}

function RiskBar({
  label,
  value,
  max,
  unavailable,
}: {
  label: string;
  value: number;
  max: number;
  unavailable: boolean;
}) {
  const width =
    max > 0 && value > 0 ? Math.max(8, Math.round((value / max) * 100)) : 0;
  return (
    <div className="report-audit-risk-row">
      <span>{label}</span>
      <div className="report-audit-risk-track" aria-hidden="true">
        <span style={{ width: `${width}%` }} />
      </div>
      <strong>{unavailable ? '—' : money(value)}</strong>
    </div>
  );
}

export function AuditRiskOverview({
  risk,
  eventsLoading,
  eventsError,
  lprLoading,
  lprError,
}: {
  risk: Risk;
  eventsLoading: boolean;
  eventsError: boolean;
  lprLoading: boolean;
  lprError: boolean;
}) {
  const max = Math.max(
    risk.undercharged,
    risk.reductions,
    risk.suggestedReductionRisk,
  );
  const eventsUnavailable = eventsLoading || eventsError;
  return (
    <section
      className="report-audit-risk-grid"
      aria-label="Resumen de auditoría"
    >
      <Metric
        icon={<DollarSign size={19} />}
        label="Pérdida posible"
        value={eventsError ? '—' : money(risk.possibleLoss)}
        tone={
          risk.possibleLoss > 0 && !eventsUnavailable ? 'danger' : undefined
        }
        loading={eventsLoading}
      />
      <Metric
        icon={<TrendingUp size={19} />}
        label="Riesgo por horario/tarifa"
        value={eventsError ? '—' : money(risk.suggestedReductionRisk)}
        tone={
          risk.suggestedReductionRisk > 0 && !eventsUnavailable
            ? 'warning'
            : undefined
        }
        loading={eventsLoading}
      />
      <Metric
        icon={<CarFront size={19} />}
        label="Descartes sospechosos"
        value={
          lprError ? '—' : risk.suspiciousDismissals.toLocaleString('es-AR')
        }
        tone={
          risk.suspiciousDismissals > 0 && !lprLoading && !lprError
            ? 'warning'
            : undefined
        }
        loading={lprLoading}
      />
      <Metric
        icon={<Shield size={19} />}
        label="Eventos auditables"
        value={eventsError ? '—' : risk.alerts.toLocaleString('es-AR')}
        loading={eventsLoading}
      />
      <div className="report-audit-risk-chart" aria-busy={eventsLoading}>
        <div className="report-audit-risk-chart-head">
          <span>Desglose económico del período</span>
          {eventsLoading ? (
            <span
              className="report-skeleton report-skeleton--value"
              aria-hidden="true"
            />
          ) : (
            <strong>{eventsError ? '—' : money(risk.possibleLoss)}</strong>
          )}
        </div>
        {eventsLoading ? (
          <div className="report-audit-risk-loading" aria-hidden="true">
            <span className="report-skeleton" />
            <span className="report-skeleton" />
            <span className="report-skeleton" />
          </div>
        ) : (
          <>
            <RiskBar
              label="Cobros bajo sugerido"
              value={risk.undercharged}
              max={max}
              unavailable={eventsError}
            />
            <RiskBar
              label="Correcciones que bajan cobro"
              value={risk.reductions}
              max={max}
              unavailable={eventsError}
            />
            <RiskBar
              label="Horario o tarifa reducida"
              value={risk.suggestedReductionRisk}
              max={max}
              unavailable={eventsError}
            />
          </>
        )}
      </div>
    </section>
  );
}
