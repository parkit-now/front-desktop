import type { PaymentMethodKind } from '../../lib/db/localDb';

/**
 * Los tipos de medio de pago que NO los crea una persona: los crea (y los
 * apaga) una integración con un tercero.
 *
 * Hoy es uno solo. Vive acá igual, y no inline en el panel, para que sumar el
 * segundo sea agregar una línea y no salir a buscar `=== 'mercadopago_qr'`
 * desparramado por la UI.
 */
export const INTEGRATION_BACKED_TYPES: readonly PaymentMethodKind[] = [
  'mercadopago_qr',
];

/**
 * POR QUÉ EL DESKTOP NO PUEDE TOCAR ESTE INTERRUPTOR
 *
 * El `enabled` de un medio integrado no es una preferencia del dueño: es un
 * hecho de otro sistema. Lo prende el backend cuando la cuenta de Mercado
 * Pago se vincula desde el panel web, y lo apaga cuando se desvincula.
 *
 * El desktop no sincroniza `mp_accounts`, así que no tiene forma de saber si
 * la cuenta sigue viva. Ofrecer un botón cuyo resultado no podés garantizar es
 * mentirle al operador. Y el camino offline lo empeora: el panel encola las
 * operaciones con `enqueuePendingOp`, o sea que un "habilitar" tocado sin red
 * se aplicaría A CIEGAS horas después, contra un estado que ya nadie miró.
 *
 * El final de esa cadena es el peor lugar posible: el operario ve "Mercado
 * Pago QR" en el modal de egreso, no puede cobrar, y el cliente está parado en
 * la ventanilla.
 *
 * Es la misma razón por la que en ningún lado te dejan tildar a mano "email
 * verificado".
 *
 * Renombrar SÍ se permite: `name` es cosmético y siempre fue del dueño.
 *
 * El `undefined` no es un caso raro: `LocalPaymentMethod.type` es opcional por
 * la ventana de upgrade de Dexie v13, así que una fila vieja puede no tenerlo
 * todavía. Sin tipo no podemos afirmar que sea integrado, y la respuesta
 * segura es `false` — se comporta como cualquier medio común, que es lo que
 * hacía hasta hoy.
 */
export function isIntegrationBacked(
  type: PaymentMethodKind | undefined,
): boolean {
  if (type === undefined) return false;
  return INTEGRATION_BACKED_TYPES.includes(type);
}

/** Si el desktop puede prender o apagar este medio. */
export function canToggleEnabled(type: PaymentMethodKind | undefined): boolean {
  return !isIntegrationBacked(type);
}

/**
 * POR QUÉ MARCAR COMO PREDETERMINADO TAMPOCO ES INOCENTE
 *
 * Al principio esto quedó permitido con el argumento de que cuál medio se
 * preselecciona al cobrar es una preferencia local, no un hecho del sistema
 * externo. El argumento es falso, y no por una cuestión de permisos: por el
 * render.
 *
 * `isDefault` no es un adorno, cambia por qué rama pasa la fila. El toggle de
 * habilitar/deshabilitar NO se renderiza para el medio predeterminado (el
 * default siempre está habilitado, así que el botón no tendría sentido). O
 * sea que marcar un medio como predeterminado le saca el único control que
 * queda para apagarlo.
 *
 * Encadenado:
 *
 *   1. Cuenta de Mercado Pago vinculada, medio habilitado.
 *   2. Alguien lo marca como predeterminado.
 *   3. El token se vence o el dueño desvincula la cuenta → el medio queda
 *      muerto, y el desktop ni se entera porque no sincroniza `mp_accounts`.
 *   4. La fila es default → no hay toggle.
 *   5. El QR muerto queda PRESELECCIONADO en el modal de egreso y nadie lo
 *      puede sacar de ahí desde esta app.
 *
 * Es exactamente el estado inválido que `canToggleEnabled` intentaba evitar,
 * alcanzado por la puerta de al lado. Por eso el bloqueo es el mismo.
 */
export function canSetDefault(type: PaymentMethodKind | undefined): boolean {
  return !isIntegrationBacked(type);
}

export const INTEGRATION_MANAGED_HINT =
  'Este medio lo administra una integración. Se habilita y se deshabilita desde el panel web, en Integraciones.';

export const INTEGRATION_DELETE_HINT =
  'Este medio no se elimina desde acá. Desvinculá la cuenta desde el panel web, en Integraciones.';

export const INTEGRATION_DEFAULT_HINT =
  'Este medio no se marca como predeterminado desde acá: si la integración se cae, queda preseleccionado al cobrar y sin forma de apagarlo. Administralo desde el panel web, en Integraciones.';
