import { ApiError } from './client';

/**
 * Traduce errores del backend a mensajes en español.
 *
 * Precedencia (de mayor a menor especificidad):
 *   1. `problem.code` — identificador estable que define el backend (catálogo
 *      en backend/src/utils/exceptions/error-codes.ts). Es la fuente de verdad.
 *   2. `(endpoint, status)` — fallback cuando el backend no manda code
 *      (clientes viejos o paths no cubiertos).
 *   3. `status` — fallback genérico por HTTP status.
 *   4. Mensaje genérico, nunca el `error.message` crudo (viene en inglés).
 *
 * Para agregar un caso nuevo: pedile al backend el `code` y agregalo al
 * diccionario CODE_MESSAGES. No hacer string matching del `detail`.
 */

export type EndpointKey =
  | 'auth.login'
  | 'auth.register'
  | 'auth.refresh'
  | 'auth.logout'
  | 'auth.forgotPassword'
  | 'auth.me';

export type TranslateContext = {
  endpoint?: EndpointKey;
};

const GENERIC_MESSAGE = 'Ocurrió un error inesperado.';
const NETWORK_MESSAGE =
  'No pudimos conectarnos con el servidor. Verificá tu conexión.';

// Catalogo estable de `code` provisto por el backend.
// Fuente: backend/src/utils/exceptions/error-codes.ts
const CODE_MESSAGES: Record<string, string> = {
  VEHICLE_NOT_FOUND: 'No encontramos el vehículo.',
  VEHICLE_DUPLICATE: 'Ya tenés un vehículo con esa marca y modelo.',
  // Tipos de vehículo (ABM por estacionamiento)
  VEHICLE_TYPE_NOT_FOUND: 'No encontramos el tipo de vehículo.',
  VEHICLE_TYPE_DUPLICATE: 'Ya tenés un tipo de vehículo con ese nombre.',
  VEHICLE_TYPE_IN_USE:
    'Hay vehículos usando este tipo. Elegí a cuál moverlos antes de eliminarlo.',
  VEHICLE_TYPE_REASSIGN_TARGET_INVALID:
    'El tipo elegido para reasignar no es válido. Actualizá la lista y probá de nuevo.',
  // Auth
  AUTH_INVALID_CREDENTIALS: 'Email o contraseña incorrectos.',
  AUTH_REFRESH_INVALID: 'Tu sesión expiró. Volvé a iniciar sesión.',
  AUTH_MISSING_TOKEN: 'Tu sesión expiró. Volvé a iniciar sesión.',
  AUTH_INVALID_TOKEN: 'Tu sesión expiró. Volvé a iniciar sesión.',
  AUTH_USER_NOT_PROVISIONED:
    'Tu cuenta todavía no está habilitada. Contactá al administrador.',
  AUTH_EMAIL_ALREADY_EXISTS: 'Ya existe una cuenta con ese email.',
  AUTH_WEAK_PASSWORD:
    'La contraseña es demasiado débil. Probá una más larga o variada.',
  AUTH_REGISTER_FAILED:
    'No pudimos crear tu cuenta. Intentalo en unos segundos.',
  AUTH_RESET_TOKEN_INVALID:
    'El link para recuperar tu contraseña venció o ya fue usado. Pedí uno nuevo.',
  AUTH_RESET_PASSWORD_FAILED:
    'No pudimos cambiar tu contraseña. Intentalo en unos segundos.',
  AUTH_LOGOUT_FAILED: 'No pudimos cerrar la sesión. Probá de nuevo.',

  // Acceso por entidad (rol owner/operator en la membership, no en el JWT).
  ENTITY_INSUFFICIENT_ROLE:
    'Tu rol en este establecimiento no permite esta acción.',
  ENTITY_NO_ACCESS: 'No tenés acceso a este establecimiento.',
  ENTRY_CLOSED_SESSION_LOCKED:
    'La caja está cerrada. Este movimiento no se puede editar.',
  ENTRY_ACTIVE_PAYMENT_LOCKED:
    'Los ingresos activos no pueden corregirse con egreso ni pagos.',
  ENTRY_CORRECTION_REASON_REQUIRED:
    'Ingresá el motivo del cambio para modificar horarios o importes.',
  ENTRY_EXIT_NOT_AFTER_ENTRY:
    'La fecha y hora de egreso debe ser mayor a la de ingreso.',

  // Medios de pago.
  // Llega por el PATCH (renombrar, prender/apagar, marcar predeterminado)
  // cuando el medio se borró entremedio. En el DELETE no se ve: ahí el panel
  // se come el 404 a propósito y limpia local, porque el medio ya no está,
  // que es justo lo que el operario quería.
  PAYMENT_METHOD_NOT_FOUND:
    'Este medio de pago ya no existe: lo eliminaron desde otro equipo o desde el panel web. Actualizá la lista y probá de nuevo.',
  PAYMENT_METHOD_SYSTEM_LOCKED:
    'Este medio lo trae el sistema: podés desactivarlo, pero no eliminarlo.',
  // Se intentó PRENDER un medio que depende de una integración externa (hoy
  // solo `mercadopago_qr`) sin la cuenta vinculada. El panel ya corta antes de
  // llamar (ver `paymentMethodUtils.ts`), pero una op encolada que se sincroniza
  // horas después llega igual acá, y el toast de sync lo muestra tal cual.
  PAYMENT_METHOD_INTEGRATION_NOT_LINKED:
    'Este medio no se puede prender desde acá. El dueño tiene que vincular Mercado Pago desde el panel web, en Integraciones.',

  // Mercado Pago. Acá le hablamos al OPERARIO en medio de un cobro, con el
  // cliente en la ventanilla: primero qué pasó, después la salida inmediata
  // (cobrar por otro medio) y recién al final quién lo arregla. El dueño es el
  // único que puede revincular, y lo hace desde el panel web.
  MP_NOT_LINKED:
    'No hay una cuenta de Mercado Pago vinculada. Cobrá en efectivo o por transferencia y avisale al dueño para que la vincule desde el panel.',
  MP_ACCOUNT_TOKEN_EXPIRED:
    'Se venció la conexión con Mercado Pago. Cobrá por otro medio y avisale al dueño para que la vuelva a vincular desde el panel.',
  MP_ACCOUNT_REVOKED:
    'Se desvinculó la cuenta de Mercado Pago. Cobrá en efectivo o por transferencia y avisale al dueño para que la vuelva a vincular desde el panel.',
  // Transitorio y del lado de Mercado Pago: no hay nada que el dueño pueda
  // arreglar, así que no lo mandamos a tocar el panel al pedo.
  MP_UNAVAILABLE:
    'Mercado Pago no está respondiendo. Cobrá en efectivo o por transferencia y probá de nuevo en unos minutos.',
  // Mercado Pago no contestó nada (timeout, DNS, socket cortado). Para el
  // backend es distinto de `MP_UNAVAILABLE` —la orden PUDO haberse creado
  // igual— pero para el operario la acción es la misma, y decirle que "no
  // sabemos si se creó" no lo ayuda a despachar el auto: el reintento es
  // idempotente, así que no puede cobrar dos veces.
  MP_UNREACHABLE:
    'No pudimos comunicarnos con Mercado Pago. Probá de nuevo en unos segundos o cobrá en efectivo.',
  MP_MALFORMED_RESPONSE:
    'Mercado Pago contestó algo que no entendemos. Probá de nuevo o cobrá en efectivo.',
  // Falló crear, leer o cancelar la orden: la playa no puede cobrar con QR
  // ahora mismo.
  MP_ORDER_CREATE_FAILED:
    'No pudimos generar el cobro con QR. Cobrá en efectivo o por transferencia y probá de nuevo en unos minutos.',
  // La cuenta está vinculada pero le falta la caja (el POS). NO se arregla
  // revinculando —por eso no comparte texto con `MP_NOT_LINKED`—, se arregla
  // resincronizando desde el panel web.
  MP_POS_NOT_PROVISIONED:
    'La caja de Mercado Pago todavía no está configurada. Cobrá por otro medio y avisale al dueño para que la resincronice desde el panel.',

  // Mercado Pago · cobros con QR (`payment_intents`). Le hablamos al operario
  // con el cliente parado en la ventanilla: qué pasó, y cómo despacha el auto.
  PAYMENT_INTENT_NOT_FOUND:
    'No encontramos ese cobro con QR. Generá uno nuevo o cobrá en efectivo.',
  // El bloqueo es de ESTA estadía: ya hay un QR vivo para este mismo auto.
  PAYMENT_INTENT_ALREADY_OPEN:
    'Este vehículo ya tiene un cobro con QR en curso. Esperá a que se pague o cancelalo antes de generar otro.',
  // El bloqueo es del auto DE AL LADO. Es un code distinto del anterior a
  // propósito: el cartel del QR es uno solo y la caja sostiene una orden a la
  // vez, así que acá no hay nada que cancelar — hay que esperar, o cobrar en
  // efectivo. Decirle "ya hay un cobro abierto" a secas lo mandaría a buscar
  // un botón de cancelar que corresponde a otra estadía.
  PAYMENT_INTENT_POS_BUSY:
    'Hay un cobro con QR en curso para otro vehículo: el cartel del QR es uno solo. Esperá a que termine o cobrá en efectivo.',
  PAYMENT_INTENT_NOT_CANCELABLE:
    'Este cobro ya no se puede cancelar: se pagó, venció o ya se canceló. Actualizá la pantalla para ver cómo quedó.',
  PAYMENT_INTENT_ENTRY_CLOSED:
    'Esta estadía ya tiene el egreso registrado, así que no se le puede cobrar con QR.',
  // El único de la familia que NO sale al generar el cobro sino AL CERRAR LA
  // ESTADÍA, con el auto en la barrera: el `paymentIntentId` que viajó en la
  // línea de pago no se pudo consumir.
  //
  // El backend manda un solo code para cinco casos (ya consumido, de otra
  // estadía, de otra playa, monto distinto, nunca aprobado) y no es una
  // simplificación suya: los cinco son el mismo `count === 0` del `updateMany`
  // con guarda, y distinguirlos exigiría una lectura extra que abriría la
  // carrera que esa sentencia existe para cerrar.
  //
  // Por eso el mensaje NO afirma cuál de los cinco fue. Decir "ya se aplicó" a
  // secas sería inventarle una causa al operario y mandarlo a buscar un cobro
  // que capaz nunca estuvo aprobado. Lo honesto es enumerar lo probable y
  // dejarlo salir por donde siempre: mirar el estado, o cobrar en efectivo.
  PAYMENT_INTENT_NOT_CONSUMABLE:
    'Ese cobro con QR no se puede aplicar a esta estadía: ya se usó, es de otro vehículo o el monto no coincide. Fijate cómo quedó y, si hace falta, generá uno nuevo o cobrá en efectivo.',

  // Validacion (envoltorio — el detalle por campo se traduce con
  // translateValidationCode).
  VALIDATION_FAILED: 'Revisá los datos del formulario.',

  // Genericos por status
  BAD_REQUEST: 'La solicitud tiene datos inválidos.',
  UNAUTHORIZED: 'No tenés autorización para esta acción.',
  FORBIDDEN: 'No tenés permiso para esta acción.',
  NOT_FOUND: 'No encontramos lo que buscabas.',
  // Facturación electrónica (ARCA). Mismo tono que Mercado Pago: el operario
  // está despachando un auto. Un problema de factura NUNCA frena el cobro, así
  // que el mensaje dice qué pasó con la factura, no con el egreso.
  ARCA_NOT_LINKED:
    'Esta playa no tiene la facturación electrónica vinculada. El dueño la vincula desde el panel web.',
  ARCA_UNAVAILABLE: 'ARCA no responde. Intentalo más tarde.',
  ARCA_CERT_EXPIRED:
    'Venció el certificado de ARCA. Avisale al dueño para que lo renueve.',
  ARCA_CERT_NOT_AUTHORIZED:
    'El certificado de ARCA no tiene habilitada la facturación. Avisale al dueño.',
  INVOICE_ALREADY_ISSUED: 'Esta estadía ya tiene una factura emitida.',
  INVOICE_IN_PROGRESS:
    'La factura se está emitiendo en este momento. Esperá unos segundos.',
  INVOICE_REJECTED: 'ARCA rechazó la factura.',
  INVOICE_RECEIVER_REQUIRED:
    'Por el monto, la factura necesita identificar al cliente (CUIT o DNI).',
  INVOICE_NOT_INVOICEABLE:
    'Esta estadía no se puede facturar: sigue abierta o se cobró $0.',
  INVOICE_RECEIVER_NOT_FOUND:
    'ARCA no tiene datos de ese CUIT. Revisalo o emití la factura a consumidor final.',
  // Ya no lo emite el backend (desde la Etapa 5 un CUIT sin A sale B
  // identificada); queda para las facturas viejas que lo tienen guardado.
  INVOICE_RECEIVER_NOT_A:
    'Ese CUIT no puede recibir Factura A (no es Responsable Inscripto ni Monotributista). Emitila de nuevo.',
  INVOICE_NOT_ISSUED: 'La factura todavía no se emitió: no tiene PDF.',
  INVOICE_PDF_FAILED: 'No se pudo generar el PDF. Probá de nuevo en un rato.',
  ARCA_FISCAL_DATA_INCOMPLETE:
    'Faltan Ingresos Brutos o la fecha de inicio de actividades: van impresos en la factura.',
  ARCA_CUIT_INVALID: 'El CUIT del cliente no es válido.',

  ENTRY_DUPLICATE_ACTIVE_STAY: 'El vehículo ya tiene un ingreso activo.',
  CONFLICT: 'Conflicto con el estado actual.',
  UNPROCESSABLE_ENTITY: 'Algunos datos no son válidos.',
  TOO_MANY_REQUESTS: 'Demasiados intentos. Esperá unos segundos.',
  INTERNAL_ERROR: 'El servidor no responde. Intentalo en unos segundos.',
  SERVICE_UNAVAILABLE: 'El servidor no responde. Intentalo en unos segundos.',
  GATEWAY_TIMEOUT: 'El servidor tardó demasiado. Intentalo en unos segundos.',

  // Persistencia
  DB_NOT_FOUND: 'No encontramos lo que buscabas.',
  DB_UNIQUE_CONSTRAINT: 'Ese dato ya está en uso.',
  DB_FOREIGN_KEY_VIOLATION: 'Una referencia obligatoria no es válida.',
  DB_VALIDATION_ERROR: 'Algunos datos no son válidos.',
  DB_CONNECTION_TIMEOUT:
    'El servidor está saturado. Intentalo en unos segundos.',
  DB_ERROR: 'El servidor no responde. Intentalo en unos segundos.',
};

// Fallback `(endpoint, status)` solo si el backend no envia `code`.
const CONTEXT_MESSAGES: Record<string, string> = {
  'auth.login:401': 'Email o contraseña incorrectos.',
  'auth.register:409': 'Ya existe una cuenta con ese email.',
  'auth.refresh:401': 'Tu sesión expiró. Volvé a iniciar sesión.',
  'auth.logout:401': 'Tu sesión ya no es válida.',
};

// Fallback final por HTTP status.
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
  return typeof code === 'string' && code.length > 0 ? code : undefined;
}

/**
 * Mensaje para un `code` suelto, cuando no viene dentro de un error HTTP: por
 * ejemplo el `errorCode` de una factura que el cierre devolvió con 200.
 */
export function translateErrorCode(
  code: string | null | undefined,
): string | undefined {
  return code ? CODE_MESSAGES[code] : undefined;
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

// Traducciones de los `code` que devuelve cada `ValidationFieldErrorDto`.
// Coinciden con los constraint names de class-validator que usa el backend.
const VALIDATION_CODE_MESSAGES: Record<string, string> = {
  isNotEmpty: 'Este campo es obligatorio.',
  isDefined: 'Este campo es obligatorio.',
  isString: 'Valor inválido.',
  isNumber: 'Debe ser un número.',
  isInt: 'Debe ser un número entero.',
  isBoolean: 'Debe ser verdadero o falso.',
  isEmail: 'Email inválido.',
  isUUID: 'Identificador inválido.',
  isDate: 'Fecha inválida.',
  isIn: 'Valor no permitido.',
  isEnum: 'Valor no permitido.',
  minLength: 'Demasiado corto.',
  maxLength: 'Demasiado largo.',
  min: 'Valor demasiado bajo.',
  max: 'Valor demasiado alto.',
};

// Override por (field, code) para mensajes mas contextuales.
const VALIDATION_FIELD_CODE_MESSAGES: Record<string, string> = {
  'password:minLength': 'La contraseña debe tener al menos 8 caracteres.',
  'password:isNotEmpty': 'Ingresá tu contraseña.',
  'email:isEmail': 'Email inválido.',
  'email:isNotEmpty': 'Ingresá tu email.',
};

/**
 * Traduce un `ValidationFieldErrorDto.code` (constraint name de
 * class-validator) al mensaje en español que va abajo del input.
 */
export function translateValidationCode(field: string, code: string): string {
  const overrideKey = `${field.toLowerCase()}:${code}`;
  const override = VALIDATION_FIELD_CODE_MESSAGES[overrideKey];
  if (override) return override;
  return VALIDATION_CODE_MESSAGES[code] ?? 'Valor inválido.';
}

// Etiquetas en español para los roles que muestra la UI.
// Rol GLOBAL (JWT): admin | user. Rol por entidad (membership): owner | operator.
const ROLE_LABELS: Record<string, string> = {
  admin: 'Administrador',
  user: 'Usuario',
  owner: 'Dueño',
  operator: 'Operador',
};

/** Traduce un rol (global o de entidad) a su etiqueta en español. */
export function translateRole(role: string): string {
  return ROLE_LABELS[role] ?? role;
}
