import { Cctv, FlaskConical } from 'lucide-react';
import { AutoEntryCard } from './AutoEntryCard';
import { useCameraDetections } from './useCameraDetections';
import { useCameraTestingMode } from './testingMode';

interface Props {
  tenantId: string;
  accessToken: string;
}

export function AutoEntriesColumns({ tenantId, accessToken }: Props) {
  const { detections, dismiss, ack } = useCameraDetections(tenantId);
  const testingMode = useCameraTestingMode();

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

      {/* Que se vea siempre: un modo prueba olvidado en producción llena esto
          de tarjetas repetidas y el operador no sabría por qué. */}
      {testingMode ? (
        <p className="csd-note csd-note--warning auto-entries__testing">
          <FlaskConical size={15} aria-hidden="true" />
          Modo prueba activo: se muestran todas las detecciones, sin descartar
          repetidas. Se apaga en Cámara → Configurar cámara.
        </p>
      ) : null}

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
