import type { components } from '../../generated/api-types';
import { apiRequest } from './client';

/**
 * Alias del contrato generado, NO una copia a mano. Mismo motivo que en
 * `payment-methods.ts`: la copia local no traía `paymentMethodType` y el
 * arqueo se quedaba sin el único dato que necesita para saber qué plata entró
 * al cajón.
 */
export type PaymentTransactionDto =
  components['schemas']['PaymentTransactionDto'];

interface PaymentTransactionChangesResponse {
  items: PaymentTransactionDto[];
  maxSeq: number;
}

export function pullPaymentTransactionChanges(params: {
  tenantId: string;
  bearer: string;
  query: { afterSeq: number };
}): Promise<PaymentTransactionChangesResponse> {
  const qs = new URLSearchParams({ afterSeq: String(params.query.afterSeq) });
  return apiRequest({
    method: 'GET',
    path: `/tenants/${params.tenantId}/payment-transactions/changes?${qs}`,
    bearer: params.bearer,
  });
}
