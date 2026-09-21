import type { components } from '../../generated/api-types';
import { apiRequest } from './client';

/**
 * Cobros con QR estático de Mercado Pago.
 *
 * ## Cómo funciona el negocio (leer antes de tocar nada acá)
 *
 * La playa tiene UN cartel con el QR impreso pegado en la ventanilla. Este
 * cliente NO pide ni dibuja ningún QR: lo único que hace es encolar una orden
 * con el monto en la caja (el POS) de Mercado Pago, para que cuando el cliente
 * escanee ese cartel de siempre le aparezca el importe a pagar.
 *
 * De ahí salen dos consecuencias que se ven en toda la feature:
 *
 *   1. El cartel es uno solo, así que la caja sostiene UNA orden a la vez. Si
 *      ya hay un cobro en curso para otro auto, el backend devuelve 409
 *      (`PAYMENT_INTENT_POS_BUSY`). No es un error: es la realidad física.
 *   2. La orden vence a los 5 minutos y el `GET` la vence perezosamente, así
 *      que el desktop no tiene que llevar ningún reloj autoritativo — el
 *      contador que ve el operario es informativo.
 *
 * ## Los tipos salen del OpenAPI, no de acá
 *
 * `AGENTS.md` prohíbe duplicar DTOs que ya existan en `api-types.ts`. Mientras
 * el backend no estuvo levantado, estos tipos se escribieron a mano bajo la
 * excepción de la política ("tipos manuales permitidos [...] cuando sync-types
 * no está disponible"). Ya no aplica: `bun run sync-types` corrió y estos son
 * alias del contrato generado.
 *
 * Que sean alias y no copias es lo que hace que un cambio del backend ROMPA la
 * compilación en vez de quedarse callado — el bug que ya se comió
 * `PaymentMethodDto`.
 */

/**
 * Estado del intento, tal como lo define el backend.
 *
 * `created`, `pending` y `approved` son los VIVOS (los que entran al índice
 * único por estadía y por caja); el resto es terminal.
 *
 * `created` merece una aclaración porque no es intuitivo: significa que la
 * fila existe pero la orden del lado de Mercado Pago puede o no existir —el
 * POST murió por timeout y no sabemos—. Para el operario es lo mismo que
 * `pending`: seguir esperando.
 *
 * 🔴 NO HAY "pago rechazado". En QR, Mercado Pago no expone los pagos
 * rechazados: la orden se queda en `created`/`pending` hasta que haya un pago
 * aprobado, y no llega ningún evento. Un rechazo y un cliente que nunca
 * escaneó son indistinguibles desde acá, así que lo único honesto es esperar
 * hasta que venza.
 */
export type PaymentIntentStatus = components['schemas']['PaymentIntentStatus'];

/** Estados en los que el cobro sigue vivo y hay que seguir pooleando. */
const LIVE_STATUSES: readonly PaymentIntentStatus[] = [
  'created',
  'pending',
  'approved',
];

/**
 * Si el intento ya no va a cambiar más y el polling tiene que cortar.
 *
 * `approved` NO es terminal para el polling: el pago está acreditado pero
 * todavía falta consumirlo (cerrar la estadía), y el backend puede moverlo a
 * `consumed` o `refunded` desde otro lado.
 */
export function isTerminalIntentStatus(status: PaymentIntentStatus): boolean {
  return !LIVE_STATUSES.includes(status);
}

/**
 * Un intento de cobro, tal como lo devuelven los tres endpoints.
 *
 * Los campos `mp*` son diagnóstico crudo de Mercado Pago: NUNCA se le muestran
 * al operario (vienen en inglés y no describen una acción). El estado que
 * manda es `status`.
 */
export type PaymentIntentDto = components['schemas']['PaymentIntentDto'];

/** Cuerpo del POST que arranca el cobro. */
export type CreatePaymentIntentDto =
  components['schemas']['CreatePaymentIntentDto'];

/**
 * Arranca el cobro.
 *
 * 🔴 El `id` lo genera EL DESKTOP (UUIDv7, `generateUuidV7`), igual que
 * `Entry` y `CashSession`, y eso es lo que hace idempotente al endpoint: si
 * este POST se corta por timeout, reintentarlo con el MISMO id devuelve el
 * intento que ya estaba en vez de crear una segunda orden —y un segundo cobro
 * al mismo cliente— en la caja de Mercado Pago.
 *
 * El `entryId` tiene FK contra `entries` DEL SERVIDOR: una estadía creada
 * offline y todavía no pusheada no existe del otro lado y esto falla con un
 * error opaco. Por eso el botón se gatea antes con `qrChargeBlockReason`.
 *
 * Nada de PII en el payload: ni la patente ni datos del cliente. Lo único que
 * viaja a Mercado Pago es el `id`, como `external_reference`.
 */
export function createPaymentIntent(input: {
  tenantId: string;
  bearer: string;
  body: CreatePaymentIntentDto;
}): Promise<PaymentIntentDto> {
  return apiRequest<PaymentIntentDto>({
    method: 'POST',
    path: `/tenants/${encodeURIComponent(input.tenantId)}/payment-intents`,
    body: input.body,
    bearer: input.bearer,
  });
}

/**
 * Lee el estado actual. Es lo que poolea el modal mientras espera.
 *
 * Vence el intento PEREZOSAMENTE: si `expiresAt` ya pasó, este GET lo mueve a
 * `expired` solo. Por eso el desktop no necesita ninguna lógica de expiración
 * propia — el contador en pantalla es para el operario, no para decidir.
 */
export function getPaymentIntent(input: {
  tenantId: string;
  bearer: string;
  id: string;
}): Promise<PaymentIntentDto> {
  return apiRequest<PaymentIntentDto>({
    method: 'GET',
    path: `/tenants/${encodeURIComponent(input.tenantId)}/payment-intents/${encodeURIComponent(input.id)}`,
    bearer: input.bearer,
  });
}

/**
 * Cancela el cobro y baja la orden del QR de la caja.
 *
 * Bajar la orden no es cosmético: el QR es ESTÁTICO, así que una orden viva
 * que quedó colgada se la termina pagando el PRÓXIMO cliente que escanee el
 * cartel — por el monto del auto anterior.
 *
 * Un 409 acá (`PAYMENT_INTENT_NOT_CANCELABLE`) no es un fallo del operario:
 * significa que el intento dejó de estar vivo mientras el modal esperaba. El
 * caso que importa es que se haya APROBADO justo antes del click, y por eso
 * quien llama tiene que releer el estado en vez de asumir que se canceló.
 */
export function cancelPaymentIntent(input: {
  tenantId: string;
  bearer: string;
  id: string;
}): Promise<PaymentIntentDto> {
  return apiRequest<PaymentIntentDto>({
    method: 'POST',
    path: `/tenants/${encodeURIComponent(input.tenantId)}/payment-intents/${encodeURIComponent(input.id)}/cancel`,
    bearer: input.bearer,
  });
}
