import { Cctv, FlaskConical, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { useToast } from '../../lib/notifications/ToastProvider';
import { ConfirmDialog } from '../../lib/ui/ConfirmDialog';
import { AutoEntryCard } from './AutoEntryCard';
import { useCameraDetections } from './useCameraDetections';
import { useCameraTestingMode } from './testingMode';

interface Props {
  tenantId: string;
  accessToken: string;
  parkingName?: string | null;
  parkingAddress?: string | null;
  parkingCuit?: string | null;
}

export function AutoEntriesColumns({
  tenantId,
  accessToken,
  parkingName = null,
  parkingAddress = null,
  parkingCuit = null,
}: Props) {
  const { detections, dismiss, dismissAll, ack } =
    useCameraDetections(tenantId);
  const testingMode = useCameraTestingMode();
  const { showToast } = useToast();
  const [discardIds, setDiscardIds] = useState<string[] | null>(null);
  const [discarding, setDiscarding] = useState(false);
  const discardingRef = useRef(false);

  async function handleDiscardAll(): Promise<void> {
    if (!discardIds || discardingRef.current) return;
    discardingRef.current = true;
    setDiscarding(true);
    try {
      const { dismissed, failed } = await dismissAll(discardIds);
      setDiscardIds(null);
      if (failed > 0) {
        showToast({
          message: `Se descartaron ${dismissed} detecciones; ${failed} no se pudieron descartar.`,
          kind: 'error',
        });
      } else if (dismissed > 0) {
        showToast({
          message: `${dismissed} ${dismissed === 1 ? 'detección descartada' : 'detecciones descartadas'}.`,
          kind: 'success',
        });
      }
    } catch {
      showToast({
        message: 'No se pudieron descartar las detecciones. Intentá de nuevo.',
        kind: 'error',
      });
    } finally {
      discardingRef.current = false;
      setDiscarding(false);
    }
  }

  return (
    <section className="auto-entries">
      <header className="auto-entries__header">
        <h3 className="auto-entries__title">
          <Cctv size={18} aria-hidden="true" />
          Ingresos detectados
        </h3>
        {detections.length > 0 ? (
          <>
            <span className="auto-entries__count">{detections.length}</span>
            <button
              type="button"
              className="auto-entries__clear"
              title="Descartar todas las detecciones"
              aria-label={`Descartar las ${detections.length} detecciones automáticas`}
              onClick={() => setDiscardIds(detections.map((d) => d.id))}
              disabled={discarding}
            >
              <Trash2 size={16} aria-hidden="true" />
            </button>
          </>
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
              parkingName={parkingName}
              parkingAddress={parkingAddress}
              parkingCuit={parkingCuit}
              onRegistered={ack}
              onDismiss={dismiss}
            />
          ))}
        </div>
      )}

      <ConfirmDialog
        open={discardIds !== null}
        title="¿Descartar todas las detecciones?"
        message={`Se descartarán ${discardIds?.length ?? 0} detecciones pendientes. Los registros de auditoría se conservarán.`}
        confirmLabel="Descartar todas"
        variant="danger"
        isPending={discarding}
        onCancel={() => setDiscardIds(null)}
        onConfirm={handleDiscardAll}
      />
    </section>
  );
}
