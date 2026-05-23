import { ApiError } from '../../lib/api/client';
import {
  translateApiError,
  translateValidationReason,
  type EndpointKey,
} from '../../lib/api/translate';
import type { FieldErrors } from './validation';

export type AuthErrorOutput = {
  fieldErrors?: FieldErrors;
  toastMessage?: string;
};

export function getErrorMessage(error: unknown): string {
  return translateApiError(error);
}

function mapBackendField(field: string): keyof FieldErrors | null {
  const lower = field.toLowerCase();
  if (lower === 'email') return 'email';
  if (lower === 'password') return 'password';
  return null;
}

const ENDPOINT_BY_CONTEXT: Record<'login' | 'register', EndpointKey> = {
  login: 'auth.login',
  register: 'auth.register',
};

export function mapAuthError(
  error: unknown,
  context: 'login' | 'register',
): AuthErrorOutput {
  if (
    error instanceof ApiError &&
    error.problem &&
    'validationsErrors' in error.problem &&
    Array.isArray(error.problem.validationsErrors)
  ) {
    const fieldErrors: FieldErrors = {};
    for (const item of error.problem.validationsErrors) {
      const key = mapBackendField(item.field);
      if (key) {
        fieldErrors[key] = translateValidationReason(item.field);
      }
    }
    if (Object.keys(fieldErrors).length > 0) {
      return { fieldErrors };
    }
  }

  return {
    toastMessage: translateApiError(error, {
      endpoint: ENDPOINT_BY_CONTEXT[context],
    }),
  };
}
