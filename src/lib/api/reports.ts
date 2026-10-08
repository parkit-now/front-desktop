import type { components } from '../../generated/api-types';
import { apiRequest } from './client';

export type MetricsSummary = components['schemas']['MetricsSummaryDto'];
export type Revenue = components['schemas']['RevenueResponseDto'];
export type PaymentBreakdown =
  components['schemas']['PaymentMethodBreakdownDto'];
export type CategoryBreakdown =
  components['schemas']['VehicleCategoryBreakdownDto'];
export type TopPlates = components['schemas']['TopPlatesResponseDto'];
export type AuditEvent = Omit<
  components['schemas']['AuditEventDto'],
  'metadata'
> & {
  metadata?: unknown;
};
export type AuditPage = Omit<
  components['schemas']['PaginatedAuditDto'],
  'items'
> & {
  items: AuditEvent[];
};
export type LprEvent = components['schemas']['LprDetectionEventDto'];
export type LprPage = components['schemas']['PaginatedLprDetectionEventsDto'];
export type Granularity = Revenue['granularity'];

type Auth = { tenantId: string; bearer: string; signal?: AbortSignal };
export type ReportScope =
  | { from: string; to: string; cashSessionId?: never }
  | { cashSessionId: string; from?: never; to?: never };
export type RevenueFilter = ReportScope & {
  granularity: Granularity;
  paymentMethod?: string;
  vehicleCategory?: string;
};

export const REPORT_MAX_ITEMS = 5_000;
const REPORT_PAGE_SIZE = 100;
const REPORT_PAGE_CONCURRENCY = 4;

const base = (tenantId: string) => `/tenants/${encodeURIComponent(tenantId)}`;

function windowQuery(
  scope: ReportScope,
  extra: Record<string, string | undefined> = {},
) {
  const params = new URLSearchParams({ tz: 'America/Argentina/Buenos_Aires' });
  if (scope.cashSessionId) params.set('cashSessionId', scope.cashSessionId);
  else {
    params.set('from', scope.from!);
    params.set('to', scope.to!);
  }
  Object.entries(extra).forEach(([key, value]) => {
    if (value) params.set(key, value);
  });
  return params.toString();
}

export function getMetricsSummary({ tenantId, bearer, signal }: Auth) {
  return apiRequest<MetricsSummary>({
    method: 'GET',
    path: `${base(tenantId)}/metrics/summary?tz=America%2FArgentina%2FBuenos_Aires`,
    bearer,
    signal,
  });
}

export function getRevenue(input: Auth & RevenueFilter) {
  const {
    tenantId,
    bearer,
    signal,
    granularity,
    paymentMethod,
    vehicleCategory,
  } = input;
  return apiRequest<Revenue>({
    method: 'GET',
    path: `${base(tenantId)}/metrics/revenue?${windowQuery(input, { granularity, paymentMethod, vehicleCategory })}`,
    bearer,
    signal,
  });
}

export function getPaymentBreakdown(
  input: Auth & ReportScope & { vehicleCategory?: string },
) {
  return apiRequest<PaymentBreakdown>({
    method: 'GET',
    path: `${base(input.tenantId)}/metrics/revenue/by-payment-method?${windowQuery(input, { vehicleCategory: input.vehicleCategory })}`,
    bearer: input.bearer,
    signal: input.signal,
  });
}

export function getCategoryBreakdown(input: Auth & ReportScope) {
  return apiRequest<CategoryBreakdown>({
    method: 'GET',
    path: `${base(input.tenantId)}/metrics/by-vehicle-category?${windowQuery(input)}`,
    bearer: input.bearer,
    signal: input.signal,
  });
}

export function getTopPlates(
  input: Auth &
    ReportScope & {
      vehicleCategory?: string;
      orderBy?: 'revenue' | 'visits' | 'duration';
    },
) {
  return apiRequest<TopPlates>({
    method: 'GET',
    path: `${base(input.tenantId)}/metrics/top-plates?${windowQuery(input, { vehicleCategory: input.vehicleCategory, orderBy: input.orderBy, limit: '10' })}`,
    bearer: input.bearer,
    signal: input.signal,
  });
}

async function collectReportPages<T>(
  fetchPage: (page: number) => Promise<{ items: T[]; total: number }>,
) {
  const first = await fetchPage(1);
  const pages: T[][] = [first.items];
  const pageCount = Math.min(
    Math.ceil(first.total / REPORT_PAGE_SIZE),
    REPORT_MAX_ITEMS / REPORT_PAGE_SIZE,
  );
  for (let start = 2; start <= pageCount; start += REPORT_PAGE_CONCURRENCY) {
    const batch = Array.from(
      { length: Math.min(REPORT_PAGE_CONCURRENCY, pageCount - start + 1) },
      (_, index) => fetchPage(start + index),
    );
    pages.push(...(await Promise.all(batch)).map((page) => page.items));
  }
  return {
    items: pages.flat().slice(0, Math.min(REPORT_MAX_ITEMS, first.total)),
    total: first.total,
  };
}

export async function listAudit(input: Auth & { from?: string; to?: string }) {
  return collectReportPages<AuditEvent>(async (page) => {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(REPORT_PAGE_SIZE),
    });
    if (input.from) params.set('from', input.from);
    if (input.to) params.set('to', input.to);
    return apiRequest<AuditPage>({
      method: 'GET',
      path: `${base(input.tenantId)}/audit?${params}`,
      bearer: input.bearer,
      signal: input.signal,
    });
  });
}

export async function listDismissedLpr(
  input: Auth & { firstSeenFrom?: string; firstSeenTo?: string },
) {
  return collectReportPages<LprEvent>(async (page) => {
    const params = new URLSearchParams({
      status: 'dismissed',
      page: String(page),
      pageSize: String(REPORT_PAGE_SIZE),
    });
    if (input.firstSeenFrom) params.set('firstSeenFrom', input.firstSeenFrom);
    if (input.firstSeenTo) params.set('firstSeenTo', input.firstSeenTo);
    return apiRequest<LprPage>({
      method: 'GET',
      path: `${base(input.tenantId)}/lpr-events?${params}`,
      bearer: input.bearer,
      signal: input.signal,
    });
  });
}

export function getLprImageUrl(input: Auth & { eventId: string }) {
  return apiRequest<
    components['schemas']['LprDetectionEventImageSignedUrlDto']
  >({
    method: 'GET',
    path: `${base(input.tenantId)}/lpr-events/${encodeURIComponent(input.eventId)}/image-signed-url`,
    bearer: input.bearer,
    signal: input.signal,
  });
}
