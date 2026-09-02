import type { components } from '../../generated/api-types';
import { apiRequest } from './client';

export type ParkingDto = components['schemas']['ParkingDto'];
type PaginatedParkingsDto = components['schemas']['PaginatedParkingsDto'];

/**
 * Lists every parking lot (admin-only endpoint). Desktop uses this to let a
 * platform `admin` — who has no entity memberships and therefore an empty
 * `GET /tenants` — pick which lot to operate from the sidebar switcher.
 */
export async function listAdminParkings(
  accessToken: string,
  search?: string,
): Promise<ParkingDto[]> {
  const query = new URLSearchParams({ pageSize: '100' });
  const trimmed = search?.trim();
  if (trimmed) {
    query.set('search', trimmed);
  }

  const page = await apiRequest<PaginatedParkingsDto>({
    method: 'GET',
    path: `/admin/parkings?${query.toString()}`,
    bearer: accessToken,
  });

  return page.items;
}
