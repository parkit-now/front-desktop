import type { components } from '../../generated/api-types';
import { apiRequest } from './client';

type LoginDto = components['schemas']['LoginDto'];
type RegisterDto = components['schemas']['RegisterDto'];
type RefreshDto = components['schemas']['RefreshDto'];

export type SessionDto = components['schemas']['SessionDto'];
export type AuthSessionResponseDto =
  components['schemas']['AuthSessionResponseDto'];

export type RegisterRole = RegisterDto['role'];

export function loginWithPassword(input: LoginDto): Promise<SessionDto> {
  return apiRequest<SessionDto>({
    method: 'POST',
    path: '/auth/login',
    body: input,
  });
}

export function registerWithPassword(
  input: RegisterDto,
): Promise<AuthSessionResponseDto> {
  return apiRequest<AuthSessionResponseDto>({
    method: 'POST',
    path: '/auth/register',
    body: input,
  });
}

export function refreshSessionTokens(input: RefreshDto): Promise<SessionDto> {
  return apiRequest<SessionDto>({
    method: 'POST',
    path: '/auth/refresh',
    body: input,
  });
}

export function logoutBackend(accessToken: string): Promise<void> {
  return apiRequest<void>({
    method: 'POST',
    path: '/auth/logout',
    bearer: accessToken,
  });
}
