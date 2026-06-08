import type { components } from '../../generated/api-types';
import { apiRequest } from './client';

type LoginDto = components['schemas']['LoginDto'];
type RegisterDto = components['schemas']['RegisterDto'];
type RefreshDto = components['schemas']['RefreshDto'];

export type SessionDto = components['schemas']['SessionDto'];
export type AuthSessionResponseDto =
  components['schemas']['AuthSessionResponseDto'];

export type MeResponseDto = components['schemas']['MeResponseDto'];
export type MeMembershipDto = components['schemas']['MeMembershipDto'];

/** Global platform role carried in the JWT (`app_metadata.role`). */
export type AppRole = MeResponseDto['role'];
/** Per-entity role, lives in the user↔entity membership (not in the JWT). */
export type EntityRole = MeMembershipDto['role'];

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

/**
 * Resolves the caller's identity, global role and entity memberships.
 *
 * The owner/operator role lives in `memberships`, not in the JWT — desktop uses
 * this to discover which entities (parking lots) the `user` can act on.
 */
export function fetchMe(accessToken: string): Promise<MeResponseDto> {
  return apiRequest<MeResponseDto>({
    method: 'GET',
    path: '/auth/me',
    bearer: accessToken,
  });
}

export function logoutBackend(accessToken: string): Promise<void> {
  return apiRequest<void>({
    method: 'POST',
    path: '/auth/logout',
    bearer: accessToken,
  });
}

export function requestPasswordReset(email: string): Promise<void> {
  return apiRequest<void>({
    method: 'POST',
    path: '/auth/forgot-password',
    body: { email },
  });
}
