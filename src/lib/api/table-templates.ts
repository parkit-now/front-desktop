import type { components } from '../../generated/api-types';
import { apiRequest } from './client';

export type SavedTableTemplateDto = components['schemas']['TableTemplateDto'];
export type SaveTableTemplateBody =
  components['schemas']['SaveTableTemplateDto'];
export type TemplateScope = {
  userId: string;
  tenantId: string;
  tableKey: string;
};
export type TemplatePlatform = 'web' | 'desktop';

function path(scope: TemplateScope, platform: TemplatePlatform): string {
  const base =
    scope.tenantId === 'admin'
      ? '/admin'
      : `/tenants/${encodeURIComponent(scope.tenantId)}`;
  const query = new URLSearchParams({ platform, tableKey: scope.tableKey });
  return `${base}/table-templates?${query}`;
}
function itemPath(
  scope: TemplateScope,
  platform: TemplatePlatform,
  id: string,
  importing = false,
): string {
  const [base, query] = path(scope, platform).split('?');
  return `${base}/${importing ? 'import/' : ''}${encodeURIComponent(id)}?${query}`;
}
export function listTableTemplates(
  scope: TemplateScope,
  platform: TemplatePlatform,
  bearer: string,
) {
  return apiRequest<SavedTableTemplateDto[]>({
    method: 'GET',
    path: path(scope, platform),
    bearer,
  });
}
export function putTableTemplate(
  scope: TemplateScope,
  platform: TemplatePlatform,
  bearer: string,
  id: string,
  body: SaveTableTemplateBody,
  importing = false,
) {
  return apiRequest<SavedTableTemplateDto>({
    method: importing ? 'POST' : 'PUT',
    path: itemPath(scope, platform, id, importing),
    bearer,
    body: {
      mutationId: body.mutationId,
      name: body.name,
      description: body.description,
      config: body.config,
      ...(importing && body.createdAt ? { createdAt: body.createdAt } : {}),
    },
  });
}
export function removeTableTemplate(
  scope: TemplateScope,
  platform: TemplatePlatform,
  bearer: string,
  id: string,
  mutationId: string,
) {
  return apiRequest<SavedTableTemplateDto>({
    method: 'DELETE',
    path: itemPath(scope, platform, id),
    bearer,
    body: { mutationId },
  });
}
