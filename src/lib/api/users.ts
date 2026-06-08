import { fetchMe, type MeResponseDto } from './auth';

export type CurrentUserDto = MeResponseDto;

export function getCurrentUser(accessToken: string): Promise<CurrentUserDto> {
  return fetchMe(accessToken);
}
