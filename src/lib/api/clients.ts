import type { components } from '../../generated/api-types';
import { apiRequest } from './client';

export type ClientDto = components['schemas']['ClientDto'];
export type CreateClientDto = components['schemas']['CreateClientDto'];
export type UpdateClientDto = components['schemas']['UpdateClientDto'];
type Credentials = { tenantId: string; bearer: string };
const path = (tenantId: string, suffix = '') =>
  `/tenants/${encodeURIComponent(tenantId)}/clients${suffix}`;

export function listClients(input: Credentials) {
  return apiRequest<ClientDto[]>({
    method: 'GET',
    path: path(input.tenantId),
    bearer: input.bearer,
  });
}
export function pullClientChanges(input: Credentials & { afterSeq: number }) {
  return apiRequest<components['schemas']['ClientChangesDto']>({
    method: 'GET',
    path: path(input.tenantId, `/changes?afterSeq=${input.afterSeq}`),
    bearer: input.bearer,
  });
}
export function createClient(input: Credentials & { body: CreateClientDto }) {
  return apiRequest<ClientDto>({
    method: 'POST',
    path: path(input.tenantId),
    bearer: input.bearer,
    body: input.body,
  });
}
export function updateClient(
  input: Credentials & {
    id: string;
    expectedVersion: number;
    body: UpdateClientDto;
  },
) {
  return apiRequest<ClientDto>({
    method: 'PATCH',
    path: path(
      input.tenantId,
      `/${encodeURIComponent(input.id)}?expectedVersion=${input.expectedVersion}`,
    ),
    bearer: input.bearer,
    body: input.body,
  });
}
export function deleteClient(
  input: Credentials & { id: string; expectedVersion: number },
) {
  return apiRequest<ClientDto>({
    method: 'DELETE',
    path: path(
      input.tenantId,
      `/${encodeURIComponent(input.id)}?expectedVersion=${input.expectedVersion}`,
    ),
    bearer: input.bearer,
  });
}
