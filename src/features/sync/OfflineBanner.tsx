import { useNetwork } from '../../lib/network/NetworkContext';

type Props = {
  /**
   * Session was restored from this machine's cache without the server being
   * able to confirm it (see `restoreSession`). Worth telling the operator so a
   * later "volvé a iniciar sesión" does not come out of nowhere.
   */
  staleSession?: boolean;
};

export function OfflineBanner({ staleSession = false }: Props) {
  const { networkUp } = useNetwork();

  // Con red levantada pero backend sin responder, "sin conexión" desorienta:
  // el operador va a revisar el Wi-Fi cuando el problema es del servidor.
  const cause = networkUp ? 'El servidor no responde' : 'Sin conexión';

  return (
    <div className="offline-banner" role="status" aria-live="polite">
      <span className="offline-banner-dot" aria-hidden="true" />
      {cause}
      {staleSession ? ' · Seguís operando con la sesión de este equipo' : ''}
      {' · Los cambios se guardan localmente'}
    </div>
  );
}
