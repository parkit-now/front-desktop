import type { components } from '../../generated/api-types';
import { apiRequest } from './client';

export type LprDetectionEventDto =
  components['schemas']['LprDetectionEventDto'];
export type UpsertLprDetectionEventDto =
  components['schemas']['UpsertLprDetectionEventDto'];
export type UpdateLprDetectionEventDto =
  components['schemas']['UpdateLprDetectionEventDto'];
export type LprDetectionEventChangesResponseDto =
  components['schemas']['LprDetectionEventChangesResponseDto'];
export type LprDetectionEventImageSignedUrlDto =
  components['schemas']['LprDetectionEventImageSignedUrlDto'];
export type LprDetectionStatus = LprDetectionEventDto['status'];
export type LprFormatType = LprDetectionEventDto['formatType'];
export type LprQualityStatus = LprDetectionEventDto['qualityStatus'];

type ChangesQuery = {
  afterSeq?: number;
  limit?: number;
};

function withQuery(
  path: string,
  query: Record<string, string | number | boolean | undefined>,
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    params.set(key, String(value));
  }
  const encoded = params.toString();
  return encoded.length > 0 ? `${path}?${encoded}` : path;
}

export function upsertLprDetectionEvent(input: {
  tenantId: string;
  bearer: string;
  body: UpsertLprDetectionEventDto;
}): Promise<LprDetectionEventDto> {
  return apiRequest<LprDetectionEventDto>({
    method: 'POST',
    path: `/tenants/${encodeURIComponent(input.tenantId)}/lpr-events`,
    body: input.body,
    bearer: input.bearer,
  });
}

export function updateLprDetectionEvent(input: {
  tenantId: string;
  bearer: string;
  eventId: string;
  body: UpdateLprDetectionEventDto;
}): Promise<LprDetectionEventDto> {
  return apiRequest<LprDetectionEventDto>({
    method: 'PATCH',
    path: `/tenants/${encodeURIComponent(input.tenantId)}/lpr-events/${encodeURIComponent(input.eventId)}`,
    body: input.body,
    bearer: input.bearer,
  });
}

export function uploadLprDetectionEventImage(input: {
  tenantId: string;
  bearer: string;
  eventId: string;
  image: Blob;
}): Promise<LprDetectionEventDto> {
  return apiRequest<LprDetectionEventDto>({
    method: 'POST',
    path: `/tenants/${encodeURIComponent(input.tenantId)}/lpr-events/${encodeURIComponent(input.eventId)}/image`,
    rawBody: { data: input.image, contentType: 'image/jpeg' },
    bearer: input.bearer,
  });
}

export function getLprDetectionEventImageSignedUrl(input: {
  tenantId: string;
  bearer: string;
  eventId: string;
}): Promise<LprDetectionEventImageSignedUrlDto> {
  return apiRequest<LprDetectionEventImageSignedUrlDto>({
    method: 'GET',
    path: `/tenants/${encodeURIComponent(input.tenantId)}/lpr-events/${encodeURIComponent(input.eventId)}/image-signed-url`,
    bearer: input.bearer,
  });
}

export function pullLprDetectionEventChanges(input: {
  tenantId: string;
  bearer: string;
  query?: ChangesQuery;
}): Promise<LprDetectionEventChangesResponseDto> {
  const basePath = `/tenants/${encodeURIComponent(input.tenantId)}/lpr-events/changes`;
  const path = withQuery(basePath, {
    afterSeq: input.query?.afterSeq,
    limit: input.query?.limit,
  });
  return apiRequest<LprDetectionEventChangesResponseDto>({
    method: 'GET',
    path,
    bearer: input.bearer,
  });
}
