import { ApiError } from './client';

/**
 * Traduce errores del backend a mensajes en español.
 *
 * Precedencia (de mayor a menor especificidad):
 *   1. `problem.code` (cuando el backend lo exponga). Patrón estilo
 *      AWS / Stripe / Google: identificador estable independiente del wording.
 *   2. `(endpoint, status)` — contexto + status HTTP.
 *   3. `status` — fallback genérico por código HTTP.
 *   4. Mensaje genérico, nunca el `error.message` crudo (viene en inglés).
 *
 * Nuevas features deben llamar a esta funcion y pasar el `endpoint` para
 * obtener mensajes contextuales. Si necesitan un mensaje custom para
 * algun caso, agregar entrada al diccionario, no hacer string matching.
 */

export type EndpointKey =
  | 'auth.login'
  | 'auth.register'
  | 'auth.refresh'
  | 'auth.logout'
  | 'users.me';

export type TranslateContext = {
  endpoint?: EndpointKey;
};

const GENERIC_MESSAGE = 'Ocurrió un error inesperado.';
const NETWORK_MESSAGE =
  'No pudimos conectarnos con el servidor. Verificá tu conexión.';

// Diccionario por `code` estable (cuando el backend lo agregue).
// Mantener vacío hasta que ProblemDetailsDto exponga `code`.
const CODE_MESSAGES: Record<string, string> = {
  // Ejemplos a habilitar cuando el backend exponga `code`:
  // AUTH_INVALID_CREDENTIALS: 'Email o contraseña incorrectos.',
  // EMAIL_ALREADY_REGISTERED: 'Ya existe una cuenta con ese email.',
};

// Mapeo (endpoint:status) → mensaje en español.
const CONTEXT_MESSAGES: Record<string, string> = {
  'auth.login:401': 'Email o contraseña incorrectos.',
  'auth.register:409': 'Ya existe una cuenta con ese email.',
  'auth.refresh:401': 'Tu sesión expiró. Volvé a iniciar sesión.',
  'auth.logout:401': 'Tu sesión ya no es válida.',
  'users.me:401': 'Tu sesión expiró. Volvé a iniciar sesión.',
};

// Fallback genérico por HTTP status.
const STATUS_MESSAGES: Record<number, string> = {
  400: 'La solicitud tiene datos inválidos.',
  401: 'No tenés autorización para esta acción.',
  403: 'No tenés permiso para esta acción.',
  404: 'No encontramos lo que buscabas.',
  409: 'Conflicto con el estado actual.',
  422: 'Algunos datos no son válidos.',
  429: 'Demasiados intentos. Esperá unos segundos.',
  500: 'El servidor no responde. Intentalo en unos segundos.',
  502: 'El servidor no responde. Intentalo en unos segundos.',
  503: 'El servidor no responde. Intentalo en unos segundos.',
  504: 'El servidor no responde. Intentalo en unos segundos.',
};

function readProblemCode(error: ApiError): string | undefined {
  const code = (error.problem as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : undefined;
}

export function translateApiError(
  error: unknown,
  ctx: TranslateContext = {},
): string {
  if (error instanceof ApiError) {
    const code = readProblemCode(error);
    if (code && CODE_MESSAGES[code]) {
      return CODE_MESSAGES[code];
    }
    if (ctx.endpoint) {
      const contextual = CONTEXT_MESSAGES[`${ctx.endpoint}:${error.status}`];
      if (contextual) return contextual;
    }
    const byStatus = STATUS_MESSAGES[error.status];
    if (byStatus) return byStatus;
    return GENERIC_MESSAGE;
  }

  // fetch() falla con TypeError cuando no hay red.
  if (error instanceof TypeError) {
    return NETWORK_MESSAGE;
  }

  return GENERIC_MESSAGE;
}

/**
 * Traduce un ValidationFieldErrorDto a un mensaje en español que va abajo
 * del input. Reglas conocidas del backend para Parkit:
 *  - email: formato invalido o ya en uso
 *  - password: minimo 8 caracteres
 * Cuando el backend agregue `code` en ValidationFieldErrorDto, priorizarlo
 * sobre este mapeo por nombre de campo.
 */
export function translateValidationReason(field: string): string {
  const lower = field.toLowerCase();
  if (lower === 'email') {
    return 'Email inválido.';
  }
  if (lower === 'password') {
    return 'La contraseña no cumple los requisitos.';
  }
  return 'Valor inválido.';
}
