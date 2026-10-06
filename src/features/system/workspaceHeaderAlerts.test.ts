import { describe, expect, it } from 'vitest';
import { getWorkspaceHeaderAlerts } from './workspaceHeaderAlerts';
import type { CameraStatus } from '../camera/useCameraStatus';

const cameraDown: CameraStatus = {
  camera: 'down',
  downSince: new Date('2026-10-05T19:00:00.000Z'),
  reconnectAttempts: 2,
  source: null,
};

describe('workspace header alerts', () => {
  it('shows camera signal when the camera source is down', () => {
    expect(
      getWorkspaceHeaderAlerts({
        cameraStatus: cameraDown,
        failedServices: [],
      }),
    ).toEqual(['camera-signal']);
  });

  it('prioritizes camera service failure over camera signal status', () => {
    expect(
      getWorkspaceHeaderAlerts({
        cameraStatus: cameraDown,
        failedServices: ['camera-service'],
      }),
    ).toEqual(['camera-service']);
  });

  it('shows lpr service failure independently', () => {
    expect(
      getWorkspaceHeaderAlerts({
        cameraStatus: null,
        failedServices: ['lpr-service'],
      }),
    ).toEqual(['lpr-service']);
  });

  it('shows multiple service failures as multiple alerts', () => {
    expect(
      getWorkspaceHeaderAlerts({
        cameraStatus: cameraDown,
        failedServices: ['camera-service', 'lpr-service'],
      }),
    ).toEqual(['camera-service', 'lpr-service']);
  });
});
