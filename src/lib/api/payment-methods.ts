import { apiRequest } from './client';

export interface PaymentMethodDto {
  id: string;
  name: string;
  enabled: boolean;
  isDefault: boolean;
  syncSeq: number;
  version: number;
  updatedAt: string;
  createdAt: string;
}

interface PaymentMethodChangesResponse {
  items: PaymentMethodDto[];
  maxSeq: number;
}

export function pullPaymentMethodChanges(params: {
  tenantId: string;
  bearer: string;
  query: { afterSeq: number };
}): Promise<PaymentMethodChangesResponse> {
  const qs = new URLSearchParams({
    afterSeq: String(params.query.afterSeq),
  });
  return apiRequest({
    method: 'GET',
    path: `/tenants/${params.tenantId}/payment-methods/changes?${qs}`,
    bearer: params.bearer,
  });
}

export function createPaymentMethod(params: {
  tenantId: string;
  bearer: string;
  body: { name: string; type?: string };
}): Promise<PaymentMethodDto> {
  return apiRequest({
    method: 'POST',
    path: `/tenants/${params.tenantId}/payment-methods`,
    bearer: params.bearer,
    body: params.body,
  });
}

export function togglePaymentMethod(params: {
  tenantId: string;
  bearer: string;
  id: string;
  body: { name?: string; enabled?: boolean; isDefault?: boolean };
}): Promise<PaymentMethodDto> {
  return apiRequest({
    method: 'PATCH',
    path: `/tenants/${params.tenantId}/payment-methods/${params.id}`,
    bearer: params.bearer,
    body: params.body,
  });
}

export function deletePaymentMethod(params: {
  tenantId: string;
  bearer: string;
  id: string;
}): Promise<void> {
  return apiRequest({
    method: 'DELETE',
    path: `/tenants/${params.tenantId}/payment-methods/${params.id}`,
    bearer: params.bearer,
  });
}
