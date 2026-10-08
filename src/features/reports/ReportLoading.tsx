export function ReportMetric({
  label,
  value,
  detail,
  loading = false,
}: {
  label: string;
  value: string;
  detail?: string;
  loading?: boolean;
}) {
  return (
    <div className="report-metric" aria-busy={loading}>
      <span>{label}</span>
      {loading ? (
        <>
          <span
            className="report-skeleton report-skeleton--value"
            aria-hidden="true"
          />
          <span className="sr-only">Cargando {label.toLowerCase()}</span>
        </>
      ) : (
        <strong>{value}</strong>
      )}
      {loading && detail ? (
        <span
          className="report-skeleton report-skeleton--detail"
          aria-hidden="true"
        />
      ) : (
        detail && <small>{detail}</small>
      )}
    </div>
  );
}

export function ReportTableLoading({
  columns,
  rows = 4,
}: {
  columns: string[];
  rows?: number;
}) {
  return (
    <div
      className="report-table-scroll dt-scroll-shell"
      role="status"
      aria-label="Cargando tabla"
    >
      <table className="report-table dt-table" aria-hidden="true">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column}>{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }, (_, row) => (
            <tr key={row}>
              {columns.map((column, index) => (
                <td key={column}>
                  <span
                    className={`report-skeleton report-skeleton--cell${index % 3 === 0 ? ' report-skeleton--short' : ''}`}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <span className="sr-only">Cargando tabla</span>
    </div>
  );
}
