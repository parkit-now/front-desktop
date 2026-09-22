import { apiRequest } from './client';

type TicketTemplatePayload = {
  version: 1;
  fields: Array<{
    id: string;
    visible: boolean;
    fontSizePt: number;
    emphasis: 'normal' | 'bold';
  }>;
  cuitOverride: string;
  grossIncomeText: string;
  nonFiscalControlText: string;
};

export type DesktopCameraConfigPayload = {
  mode: 'webcam' | 'ip';
  deviceIndex: number;
  host: string;
  port: number;
  username: string;
  streamPath: string;
  cameraId: string;
  location: 'entrada' | 'salida';
  tuning?: Record<string, unknown> | null;
};

export type EntityProfileSettingsDto = {
  ticketTemplate: TicketTemplatePayload | null;
  desktopCameraConfig: DesktopCameraConfigPayload | null;
};

export function fetchEntityProfileSettings(
  tenantId: string,
  accessToken: string,
): Promise<EntityProfileSettingsDto> {
  return apiRequest<EntityProfileSettingsDto>({
    method: 'GET',
    path: `/tenants/${tenantId}`,
    bearer: accessToken,
  });
}

export function updateEntityTicketTemplate(
  tenantId: string,
  accessToken: string,
  ticketTemplate: TicketTemplatePayload,
): Promise<EntityProfileSettingsDto> {
  return apiRequest<EntityProfileSettingsDto>({
    method: 'PATCH',
    path: `/tenants/${tenantId}`,
    bearer: accessToken,
    body: { ticketTemplate },
  });
}

export function updateEntityDesktopCameraConfig(
  tenantId: string,
  accessToken: string,
  desktopCameraConfig: DesktopCameraConfigPayload,
): Promise<EntityProfileSettingsDto> {
  return apiRequest<EntityProfileSettingsDto>({
    method: 'PATCH',
    path: `/tenants/${tenantId}`,
    bearer: accessToken,
    body: { desktopCameraConfig },
  });
}
