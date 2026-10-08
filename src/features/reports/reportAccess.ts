export type VerifiedReportMembership = {
  token: string;
  userId: string;
  tenantIds: string[];
};

export function hasVerifiedReportAccess(
  verified: VerifiedReportMembership | null,
  token: string,
  userId: string,
  tenantId: string | null,
) {
  return Boolean(
    tenantId &&
    verified?.token === token &&
    verified.userId === userId &&
    verified.tenantIds.includes(tenantId),
  );
}
