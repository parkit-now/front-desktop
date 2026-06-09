import { apiRequest } from './client';

export interface CashSessionDto {
  id: string;
  tenantId: string;
  openedAt: string;
  closedAt?: string | null;
  openingCash: number;
  leavingCash?: number | null;
  notes?: string | null;
  version: number;
  syncSeq: number;
  updatedAt: string;
}

export interface CreateCashSessionDto {
  id: string;
  openedAt: string;
  openingCash?: number;
}

export interface CloseCashSessionDto {
  newSessionId: string;
  closedAt?: string;
  leavingCash?: number;
  notes?: string;
}

export interface CloseCashSessionResponseDto {
  closedSession: CashSessionDto;
  newSession: CashSessionDto;
  carriedOverCount: number;
}

interface CashSessionChangesResponse {
  items: CashSessionDto[];
  maxSeq: number;
}

export function createCashSession(params: {
  tenantId: string;
  bearer: string;
  body: CreateCashSessionDto;
}): Promise<CashSessionDto> {
  return apiRequest({
    method: 'POST',
    path: `/tenants/${params.tenantId}/cash-sessions`,
    bearer: params.bearer,
    body: params.body,
  });
}

export function closeCashSession(params: {
  tenantId: string;
  bearer: string;
  sessionId: string;
  body: CloseCashSessionDto;
}): Promise<CloseCashSessionResponseDto> {
  return apiRequest({
    method: 'PATCH',
    path: `/tenants/${params.tenantId}/cash-sessions/${params.sessionId}/close`,
    bearer: params.bearer,
    body: params.body,
  });
}

export function pullCashSessionChanges(params: {
  tenantId: string;
  bearer: string;
  query: { afterSeq: number };
}): Promise<CashSessionChangesResponse> {
  const qs = new URLSearchParams({ afterSeq: String(params.query.afterSeq) });
  return apiRequest({
    method: 'GET',
    path: `/tenants/${params.tenantId}/cash-sessions/changes?${qs}`,
    bearer: params.bearer,
  });
}
