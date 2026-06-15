import { AlertTriangle } from 'lucide-react';
import { useEffect, useState } from 'react';

interface Props {
  collapsed?: boolean;
}

export function LprStatusIndicator({ collapsed = false }: Props) {
  const [down, setDown] = useState(false);

  useEffect(() => {
    const bridge = window.parkitDesktop;
    if (!bridge) return;

    let mounted = true;

    void bridge.getFailedServices().then((names) => {
      if (mounted && names.includes('lpr-service')) setDown(true);
    });

    const unsub = bridge.onServiceCrashed((name) => {
      if (name === 'lpr-service') setDown(true);
    });

    return () => {
      mounted = false;
      unsub();
    };
  }, []);

  if (!down) return null;

  const label = 'Servicio LPR no disponible';

  return (
    <div
      className="lpr-status-indicator"
      title={label}
      aria-label={label}
      role="status"
    >
      <AlertTriangle size={16} aria-hidden="true" />
      {!collapsed && (
        <span className="lpr-status-indicator__label">{label}</span>
      )}
    </div>
  );
}
