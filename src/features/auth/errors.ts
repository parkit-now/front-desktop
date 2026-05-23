import { ApiError } from '../../lib/api/client';
import type { FieldErrors } from './validation';

export type AuthErrorOutput = {
  fieldErrors?: FieldErrors;
  toastMessage?: string;
};

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return 'Ocurrió un error inesperado.';
}

function mapBackendField(field: string): keyof FieldErrors | null {
  const lower = field.toLowerCase();
  if (lower === 'email') return 'email';
  if (lower === 'password') return 'password';
  return null;
}

export function mapAuthError(
  error: unknown,
  context: 'login' | 'register',
): AuthErrorOutput {
  if (error instanceof ApiError) {
    if (
      error.problem &&
      'validationsErrors' in error.problem &&
      Array.isArray(error.problem.validationsErrors)
    ) {
      const fieldErrors: FieldErrors = {};
      let unmappedFirstReason: string | undefined;
      for (const item of error.problem.validationsErrors) {
        const key = mapBackendField(item.field);
        if (key) {
          fieldErrors[key] = item.reason;
        } else if (!unmappedFirstReason) {
          unmappedFirstReason = item.reason;
        }
      }
      if (Object.keys(fieldErrors).length > 0) {
        return { fieldErrors };
      }
      if (unmappedFirstReason) {
        return { toastMessage: unmappedFirstReason };
      }
    }

    if (error.status === 401 && context === 'login') {
      return { toastMessage: 'Email o contraseña incorrectos.' };
    }
    if (error.status === 409 && context === 'register') {
      return { toastMessage: 'Ya existe una cuenta con ese email.' };
    }
    if (error.status >= 500) {
      return {
        toastMessage: 'El servidor no responde. Intentalo en unos segundos.',
      };
    }
    return { toastMessage: error.message };
  }

  return { toastMessage: getErrorMessage(error) };
}
