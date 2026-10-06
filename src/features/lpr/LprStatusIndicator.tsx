import { AlertTriangle } from 'lucide-react';
import {
  hasDesktopServiceFailure,
  type DesktopServiceName,
} from '../system/useDesktopServiceFailures';

interface Props {
  collapsed?: boolean;
  failedServices: readonly DesktopServiceName[];
}

export function LprStatusIndicator({
  collapsed = false,
  failedServices,
}: Props) {
  const down = hasDesktopServiceFailure(failedServices, 'lpr-service');

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
