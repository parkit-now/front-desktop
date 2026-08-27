import { AlertTriangle, Cctv, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { EntryFormCore } from '../entries/EntryFormCore';
import { CAMERA_BASE_URL, type PendingDetection } from './useCameraDetections';

interface Props {
  detection: PendingDetection;
  tenantId: string;
  accessToken: string;
  onRegistered: (eventId: string, entryId: string) => void;
  onDismiss: (eventId: string) => void;
}

export function AutoEntryCard({
  detection,
  tenantId,
  accessToken,
  onRegistered,
  onDismiss,
}: Props) {
  const [imgError, setImgError] = useState(false);
  const [imageRetry, setImageRetry] = useState(0);
  const confidencePct = Math.round(detection.confidence * 100);
  const detectedAtLabel = new Date(detection.firstSeenAt).toLocaleTimeString(
    'es-AR',
    { hour: '2-digit', minute: '2-digit', hour12: false },
  );
  const needsManualPlate =
    !detection.formatValid ||
    detection.qualityStatus === 'invalid_format' ||
    detection.qualityStatus === 'low_confidence';
  const displayPlate =
    detection.displayPlate ??
    detection.normalizedText ??
    detection.rawText ??
    '';

  // A re-detection updates the capture image; reset any transient error state.
  useEffect(() => {
    setImgError(false);
    setImageRetry(0);
  }, [detection.bestCaptureId]);

  useEffect(() => {
    if (!imgError || !detection.bestCaptureId) return;
    const id = window.setTimeout(() => {
      setImageRetry((retry) => retry + 1);
      setImgError(false);
    }, 2_000);
    return () => window.clearTimeout(id);
  }, [imgError, detection.bestCaptureId]);

  return (
    <section
      className={`auto-entry-card${needsManualPlate ? ' auto-entry-card--attention' : ''}`}
    >
      <header className="auto-entry-card__header">
        {imgError || !detection.bestCaptureId ? (
          <div className="auto-entry-card__noimg">
            <Cctv size={28} aria-hidden="true" />
            <span>{displayPlate}</span>
          </div>
        ) : (
          <img
            key={`${detection.bestCaptureId}:${imageRetry}`}
            className="auto-entry-card__image"
            src={`${CAMERA_BASE_URL}/capture/${encodeURIComponent(detection.bestCaptureId)}/plate.jpg?r=${imageRetry}`}
            alt={`Patente detectada ${displayPlate}`}
            onError={() => setImgError(true)}
          />
        )}
        <span className="auto-entry-card__time" title="Hora de detección">
          {detectedAtLabel}
        </span>
        <span
          className={`auto-entry-card__badge${needsManualPlate ? ' warn' : ''}`}
          title="Confianza del LPR"
        >
          {confidencePct}%
        </span>
      </header>

      {needsManualPlate ? (
        <div className="auto-entry-card__warning">
          <AlertTriangle size={16} aria-hidden="true" />
          <span>Verificar patente</span>
        </div>
      ) : null}

      <EntryFormCore
        tenantId={tenantId}
        accessToken={accessToken}
        variant="auto"
        initialPlate={needsManualPlate ? '' : detection.normalizedText}
        onRegistered={({ entryId }) => onRegistered(detection.id, entryId)}
        extraActions={
          <button
            type="button"
            className="ghost-button auto-entry-card__dismiss"
            onClick={() => onDismiss(detection.id)}
          >
            <X size={16} aria-hidden="true" />
            Descartar
          </button>
        }
      />
    </section>
  );
}
