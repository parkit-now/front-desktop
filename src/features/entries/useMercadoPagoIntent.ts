import { useCallback, useEffect, useRef, useState } from 'react';
import {
  cancelPaymentIntent,
  createPaymentIntent,
  getPaymentIntent,
  isTerminalIntentStatus,
  type PaymentIntentDto,
  type PaymentIntentStatus,
} from '../../lib/api/payment-intents';
import { translateApiError } from '../../lib/api/translate';
import { generateUuidV7 } from './entryUtils';

/** Cada cuánto se le pregunta al backend por el estado del cobro. */
const POLL_INTERVAL_MS = 5_000;

/** El contador de la pantalla baja de a un segundo. */
const COUNTDOWN_TICK_MS = 1_000;

/**
 * Segundos que le quedan al cobro, para el cartel de la pantalla.
 *
 * NUNCA devuelve un número negativo. Un contador que sigue bajando después del
 * cero ("-0:14") le dice al operario que algo se rompió, cuando en realidad lo
 * único que pasó es que el cobro venció y el próximo poll lo va a confirmar.
 *
 * Es INFORMATIVO, no autoritativo: quien vence el intento es el backend, y lo
 * hace perezosamente en el `GET`. Acá no se decide nada, se muestra.
 */
export function secondsLeft(
  expiresAt: string | null | undefined,
  nowMs: number,
): number {
  if (!expiresAt) return 0;
  const endMs = new Date(expiresAt).getTime();
  if (!Number.isFinite(endMs)) return 0;
  // Ceil y no floor: apenas se crea el intento faltan 299,4 s y el operario
  // tiene que leer "5:00", no "4:59".
  return Math.max(0, Math.ceil((endMs - nowMs) / 1000));
}

/** `m:ss`, que es como se lee una cuenta regresiva corta. */
export function formatCountdown(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/** Tono visual del bloque de estado. */
export type QrTone = 'wait' | 'ok' | 'warn' | 'error';

/** Lo que la pantalla de espera tiene que mostrar y ofrecer. */
export interface QrView {
  tone: QrTone;
  /** Titular, grande. */
  title: string;
  /** Qué tiene que HACER el operario ahora. Una línea, en criollo. */
  detail: string;
  showCountdown: boolean;
  canCancel: boolean;
  canRetry: boolean;
  /** El pago está acreditado: falta cerrar la estadía. */
  canConfirm: boolean;
}

/**
 * Estado del intento → qué ve el operario.
 *
 * 🔴 ACÁ NO EXISTE "PAGO RECHAZADO", Y NO ES UN OLVIDO
 *
 * Verificado contra la doc de Mercado Pago: en QR los pagos rechazados NO se
 * exponen. La orden se queda en `created`/`pending` hasta que haya un pago
 * aprobado, y no llega ningún evento por el rechazo. O sea que "la tarjeta del
 * cliente rebotó" y "el cliente nunca escaneó el cartel" son, desde acá,
 * exactamente el mismo silencio.
 *
 * Por eso un vencimiento se cuenta como "no llegó ningún pago" y nunca como
 * "probá con otra tarjeta": ese mensaje sería inventarle al operario una
 * causa que nadie nos informó, y mandarlo a pedirle otra tarjeta a un cliente
 * que capaz ni sacó el celular.
 *
 * 🔴 `failed` TAMPOCO SIGNIFICA QUE EL CLIENTE NO PAGÓ
 *
 * Significa que no pudimos ni CREAR la orden en Mercado Pago. El cliente no
 * llegó a ver ningún importe en la pantalla: no hay nada que reclamarle. La
 * salida es reintentar o cobrar en efectivo.
 */
export function describeIntentState(status: PaymentIntentStatus): QrView {
  switch (status) {
    // `created` y `pending` son lo mismo para el operario: seguir esperando.
    // La diferencia (si la orden ya existe del lado de Mercado Pago) es un
    // detalle de recuperación del backend, no una acción de nadie acá.
    case 'created':
    case 'pending':
      return {
        tone: 'wait',
        title: 'Esperando el pago',
        detail: 'Pedile al cliente que escanee el QR del mostrador.',
        showCountdown: true,
        canCancel: true,
        canRetry: false,
        canConfirm: false,
      };
    case 'approved':
      return {
        tone: 'ok',
        title: 'Pago acreditado',
        detail: 'Confirmá el egreso para cerrar la estadía.',
        showCountdown: false,
        canCancel: false,
        canRetry: false,
        canConfirm: true,
      };
    case 'consumed':
      return {
        tone: 'ok',
        title: 'Cobro ya aplicado',
        detail: 'Esta estadía ya se cerró con este pago.',
        showCountdown: false,
        canCancel: false,
        canRetry: false,
        canConfirm: false,
      };
    case 'expired':
      return {
        tone: 'warn',
        title: 'Venció el tiempo del cobro',
        detail:
          'No entró ningún pago. Generá otro QR o cobrá en efectivo: el auto sale igual.',
        showCountdown: false,
        canCancel: false,
        canRetry: true,
        canConfirm: false,
      };
    case 'canceled':
      return {
        tone: 'warn',
        title: 'Cobro cancelado',
        detail: 'Generá otro QR o cobrá en efectivo.',
        showCountdown: false,
        canCancel: false,
        canRetry: true,
        canConfirm: false,
      };
    case 'failed':
      return {
        tone: 'error',
        title: 'No se pudo generar el cobro',
        detail:
          'Mercado Pago no llegó a crear la orden, así que el cliente nunca vio un importe. Probá de nuevo o cobrá en efectivo.',
        showCountdown: false,
        canCancel: false,
        canRetry: true,
        canConfirm: false,
      };
    case 'refunded':
      return {
        tone: 'warn',
        title: 'El pago se devolvió',
        detail: 'Esa plata volvió al cliente. Cobrá de nuevo o en efectivo.',
        showCountdown: false,
        canCancel: false,
        canRetry: true,
        canConfirm: false,
      };
    case 'charged_back':
      return {
        tone: 'error',
        title: 'El cliente desconoció el pago',
        detail: 'Avisale al dueño. Por ahora, cobrá por otro medio.',
        showCountdown: false,
        canCancel: false,
        canRetry: true,
        canConfirm: false,
      };
  }
}

export interface UseMercadoPagoIntentResult {
  intent: PaymentIntentDto | null;
  /** `null` mientras no haya cobro arrancado. */
  view: QrView | null;
  secondsLeft: number;
  isStarting: boolean;
  isCanceling: boolean;
  /** Error traducido del último POST/cancel, si hubo. */
  errorMessage: string | null;
  start: () => Promise<void>;
  cancel: () => Promise<void>;
  /** Vuelve al formulario de cobro normal, sin tocar nada del servidor. */
  reset: () => void;
}

/**
 * El cobro con QR de una estadía: arrancarlo, seguirlo y cancelarlo.
 *
 * 🔴 POR QUÉ EL CORTE DEL POLLING ESTÁ ESCRITO CON TANTO CUIDADO
 *
 * Esto es una app de ESCRITORIO que queda abierta todo el turno, muchas veces
 * días. Un `setInterval` que sobrevive al desmonte no es un detalle de
 * prolijidad: son requests cada 5 segundos, para siempre, por cada modal que
 * el operario abrió y cerró. Al final del turno hay decenas corriendo en
 * paralelo contra un backend que no las pidió.
 *
 * Los dos cortes:
 *
 *   1. AL DESMONTAR — el `return` del efecto limpia los dos intervalos, y
 *      `mountedRef` además descarta las respuestas que ya estaban en vuelo
 *      (si no, un `setState` cae sobre un componente que no existe).
 *   2. EN CUALQUIER ESTADO TERMINAL — el efecto depende de `isLive`, así que
 *      cuando el intento deja de estar vivo React limpia los intervalos y no
 *      vuelve a armarlos. Nada que pooleaar: el estado ya no cambia más.
 */
export function useMercadoPagoIntent(params: {
  tenantId: string;
  accessToken: string;
  entryId: string;
  /** Monto a cobrar. Se CONGELA al crear el intento y no se recalcula. */
  amount: number;
}): UseMercadoPagoIntentResult {
  const { tenantId, accessToken, entryId, amount } = params;

  const [intent, setIntent] = useState<PaymentIntentDto | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [isStarting, setIsStarting] = useState(false);
  const [isCanceling, setIsCanceling] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const intentId = intent?.id;
  const isLive = intent !== null && !isTerminalIntentStatus(intent.status);

  const poll = useCallback(
    async (id: string): Promise<void> => {
      try {
        const fresh = await getPaymentIntent({
          tenantId,
          bearer: accessToken,
          id,
        });
        if (!mountedRef.current) return;
        setIntent(fresh);
      } catch {
        // Un poll que falla NO es un cobro fallido: puede ser un bache de red
        // de tres segundos. Se ignora en silencio y el próximo tick reintenta.
        // Pisar la pantalla con un error acá haría parpadear un cartel rojo
        // sobre un cobro que está perfectamente vivo.
      }
    },
    [accessToken, tenantId],
  );

  useEffect(() => {
    if (!intentId || !isLive) return;

    const pollTimer = window.setInterval(() => {
      void poll(intentId);
    }, POLL_INTERVAL_MS);
    const countdownTimer = window.setInterval(() => {
      setNowMs(Date.now());
    }, COUNTDOWN_TICK_MS);

    return () => {
      window.clearInterval(pollTimer);
      window.clearInterval(countdownTimer);
    };
  }, [intentId, isLive, poll]);

  const start = useCallback(async (): Promise<void> => {
    setIsStarting(true);
    setErrorMessage(null);
    try {
      const created = await createPaymentIntent({
        tenantId,
        bearer: accessToken,
        // El id lo ponemos nosotros: es lo que hace que reintentar este POST
        // devuelva el mismo cobro en vez de crear un segundo.
        body: { id: generateUuidV7(), entryId, amount },
      });
      if (!mountedRef.current) return;
      setIntent(created);
      setNowMs(Date.now());
    } catch (error) {
      if (!mountedRef.current) return;
      // Los 409 de caja ocupada y de cobro ya abierto salen traducidos de
      // `CODE_MESSAGES`, con el texto que le sirve al operario.
      setErrorMessage(translateApiError(error));
    } finally {
      if (mountedRef.current) setIsStarting(false);
    }
  }, [accessToken, amount, entryId, tenantId]);

  const cancel = useCallback(async (): Promise<void> => {
    if (!intent) return;
    const id = intent.id;
    setIsCanceling(true);
    setErrorMessage(null);
    try {
      await cancelPaymentIntent({ tenantId, bearer: accessToken, id });
      if (!mountedRef.current) return;
      // Cancelado: se vuelve al formulario y el operario cobra por otro medio.
      // Dejarle un cartel de "cancelado" sería un click más para hacer lo que
      // ya decidió hacer.
      setIntent(null);
    } catch (error) {
      if (!mountedRef.current) return;
      // Un 409 acá casi siempre significa que el cobro dejó de estar vivo
      // JUSTO ANTES del click, y el caso que importa es que se haya APROBADO:
      // si borráramos el intento, el operario cerraría la estadía en efectivo
      // sobre una plata que el cliente ya pagó. Por eso se relee el estado
      // real en vez de asumir nada.
      try {
        const fresh = await getPaymentIntent({
          tenantId,
          bearer: accessToken,
          id,
        });
        if (mountedRef.current) setIntent(fresh);
      } catch {
        if (mountedRef.current) setErrorMessage(translateApiError(error));
      }
    } finally {
      if (mountedRef.current) setIsCanceling(false);
    }
  }, [accessToken, intent, tenantId]);

  const reset = useCallback((): void => {
    setIntent(null);
    setErrorMessage(null);
  }, []);

  return {
    intent,
    view: intent ? describeIntentState(intent.status) : null,
    secondsLeft: secondsLeft(intent?.expiresAt, nowMs),
    isStarting,
    isCanceling,
    errorMessage,
    start,
    cancel,
    reset,
  };
}
