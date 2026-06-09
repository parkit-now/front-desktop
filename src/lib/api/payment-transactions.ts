import { apiRequest } from './client';

export interface PaymentTransactionDto {
  id: string;
  tenantId: string;
  entryId: string;
  cashSessionId?: string | null;
  paymentMethodId?: string | null;
  paymentMethodName: string;
  amount: number;
  version: number;
  syncSeq: number;
  updatedAt: string;
}

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
