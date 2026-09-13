import type { components } from '../../generated/api-types';
import { apiRequest } from './client';

/**
 * Alias del contrato generado, NO una copia a mano.
 *
 * Esto era una `interface` escrita acá, campo por campo. Se le fue quedando
 * atrás al backend y el costo no fue teórico: le faltaba `type`, así que el
 * desktop literalmente no tenía forma de saber si un medio era efectivo y el
 * arqueo de caja terminó adivinándolo por el nombre. Ese fue el bug.
 *
 * Duplicar un DTO que ya existe en el OpenAPI está prohibido justamente por
 * esto (ver AGENTS.md, "Política de contratos API"): una copia a mano no falla
 * al compilar cuando el original cambia — se queda callada.
 */
export type PaymentMethodDto = components['schemas']['PaymentMethodSummaryDto'];

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
