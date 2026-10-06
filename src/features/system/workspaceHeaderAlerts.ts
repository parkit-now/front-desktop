import type { CameraStatus } from '../camera/useCameraStatus';
import {
  hasDesktopServiceFailure,
  type DesktopServiceName,
} from './useDesktopServiceFailures';

export type WorkspaceHeaderAlert =
  | 'camera-signal'
  | 'camera-service'
  | 'lpr-service';

export function getWorkspaceHeaderAlerts({
  cameraStatus,
  failedServices,
}: {
  cameraStatus: CameraStatus | null;
  failedServices: readonly DesktopServiceName[];
}): WorkspaceHeaderAlert[] {
  const cameraServiceDown = hasDesktopServiceFailure(
    failedServices,
    'camera-service',
  );
  const lprServiceDown = hasDesktopServiceFailure(
    failedServices,
    'lpr-service',
  );
  const alerts: WorkspaceHeaderAlert[] = [];

  if (cameraServiceDown) {
    alerts.push('camera-service');
  }

  if (lprServiceDown) {
    alerts.push('lpr-service');
  }

  if (!cameraServiceDown && cameraStatus && cameraStatus.camera !== 'ok') {
    alerts.push('camera-signal');
  }

  return alerts;
}
