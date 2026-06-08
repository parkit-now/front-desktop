export function OfflineBanner() {
  return (
    <div className="offline-banner" role="status" aria-live="polite">
      <span className="offline-banner-dot" aria-hidden="true" />
      Sin conexión · Los cambios se guardan localmente
    </div>
  );
}
