import { Cctv } from 'lucide-react';
import { AutoEntryCard } from './AutoEntryCard';
import { useCameraDetections } from './useCameraDetections';

interface Props {
  tenantId: string;
  accessToken: string;
}

export function AutoEntriesColumns({ tenantId, accessToken }: Props) {
  const { detections, dismiss, ack } = useCameraDetections(tenantId);

  return (
    <section className="auto-entries">
      <header className="auto-entries__header">
        <h3 className="auto-entries__title">
          <Cctv size={18} aria-hidden="true" />
          Ingresos detectados
        </h3>
        {detections.length > 0 ? (
          <span className="auto-entries__count">{detections.length}</span>
        ) : null}
      </header>

      {detections.length === 0 ? (
        <div className="auto-entries__empty">
          <Cctv size={36} aria-hidden="true" />
          <p className="muted">
            Las patentes que detecte la cámara aparecerán acá como ingresos
            listos para corroborar.
          </p>
        </div>
      ) : (
        <div className="auto-entries__grid">
          {detections.map((detection) => (
            <AutoEntryCard
              key={detection.id}
              detection={detection}
              tenantId={tenantId}
              accessToken={accessToken}
              onRegistered={ack}
              onDismiss={dismiss}
            />
          ))}
        </div>
      )}
    </section>
  );
}
