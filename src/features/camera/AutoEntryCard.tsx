import { Cctv, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { EntryFormCore } from '../entries/EntryFormCore';
import { CAMERA_BASE_URL, type PendingDetection } from './useCameraDetections';

interface Props {
  detection: PendingDetection;
  tenantId: string;
  accessToken: string;
  onRegistered: (plate: string) => void;
  onDismiss: (plate: string) => void;
}

export function AutoEntryCard({
  detection,
  tenantId,
  accessToken,
  onRegistered,
  onDismiss,
}: Props) {
  const [imgError, setImgError] = useState(false);
  const confidencePct = Math.round(detection.confidence * 100);

  // A re-detection updates the capture image — retry instead of staying broken.
  useEffect(() => setImgError(false), [detection.capture_id]);

  return (
    <section className="auto-entry-card">
      <header className="auto-entry-card__header">
        {imgError ? (
          <div className="auto-entry-card__noimg">
            <Cctv size={28} aria-hidden="true" />
            <span>{detection.plate}</span>
          </div>
        ) : (
          <img
            className="auto-entry-card__image"
            src={`${CAMERA_BASE_URL}/capture/${encodeURIComponent(detection.capture_id)}/plate.jpg`}
            alt={`Patente detectada ${detection.plate}`}
            onError={() => setImgError(true)}
          />
        )}
        <span className="auto-entry-card__badge" title="Confianza del LPR">
          {confidencePct}%
        </span>
      </header>

      <EntryFormCore
        tenantId={tenantId}
        accessToken={accessToken}
        variant="auto"
        initialPlate={detection.text}
        onRegistered={onRegistered}
        extraActions={
          <button
            type="button"
            className="ghost-button auto-entry-card__dismiss"
            onClick={() => onDismiss(detection.text)}
          >
            <X size={16} aria-hidden="true" />
            Descartar
          </button>
        }
      />
    </section>
  );
}
