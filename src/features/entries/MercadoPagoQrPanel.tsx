import { QrCode } from 'lucide-react';
import { formatArs } from '../../lib/format/argentina';
import { formatCountdown, type QrView } from './useMercadoPagoIntent';

interface Props {
  /** Monto congelado del cobro. */
  amount: number;
  view: QrView;
  secondsLeft: number;
  isCanceling: boolean;
  isConfirming: boolean;
  onCancel: () => void;
  onRetry: () => void;
  /** Volver al formulario para cobrar por otro medio (siempre disponible). */
  onUseAnotherMethod: () => void;
  /** Cerrar la estadía con el pago ya acreditado. */
  onConfirm: () => void;
}

/**
 * La pantalla de espera del cobro con QR.
 *
 * 🔴 ACÁ NO SE DIBUJA NINGÚN QR, Y ESO ESTÁ BIEN
 *
 * La playa tiene UN cartel con el QR impreso pegado en la ventanilla. El
 * cliente escanea ese, el de siempre. Lo que hizo el sistema fue encolar una
 * orden con el monto en la caja de Mercado Pago, así que cuando escanee le
 * aparece el importe a pagar.
 *
 * Por eso el protagonista de esta pantalla es EL MONTO, grande: es lo único
 * que el operario tiene que poder verificar de un vistazo contra lo que el
 * cliente ve en el celular. Y la instrucción está escrita para el operario, no
 * para el cliente, porque el que lee la pantalla es él.
 *
 * SIEMPRE HAY SALIDA POR EFECTIVO
 *
 * "Cobrar por otro medio" se renderiza en TODOS los estados, incluso mientras
 * se espera. Un cliente que se cansa de intentar y saca la plata del bolsillo
 * no puede quedar trabado detrás de una cuenta regresiva.
 */
export function MercadoPagoQrPanel({
  amount,
  view,
  secondsLeft,
  isCanceling,
  isConfirming,
  onCancel,
  onRetry,
  onUseAnotherMethod,
  onConfirm,
}: Props) {
  return (
    <div className="qr-panel">
      <div
        className={`qr-status qr-status--${view.tone}`}
        role="status"
        aria-live="polite"
      >
        <span className="qr-status-title">{view.title}</span>
        <span className="qr-status-detail">{view.detail}</span>
      </div>

      <div className="qr-amount-block">
        <span className="qr-amount-label">A cobrar</span>
        <span className="qr-amount">{formatArs(amount)}</span>
      </div>

      {view.showCountdown ? (
        <div className="qr-countdown" role="timer" aria-live="off">
          <QrCode size={18} aria-hidden="true" />
          {/*
            El contador es informativo: el que vence el cobro es el servidor,
            perezosamente, en el próximo GET. Llegar a 0:00 acá no cambia el
            estado, sólo avisa que ya falta poco para que el poll lo confirme.
          */}
          <span>
            Vence en <strong>{formatCountdown(secondsLeft)}</strong>
          </span>
        </div>
      ) : null}

      <div className="rate-dialog-actions">
        <button
          type="button"
          className="ghost-button"
          onClick={onUseAnotherMethod}
          disabled={isCanceling || isConfirming}
        >
          Cobrar por otro medio
        </button>

        {view.canCancel ? (
          <button
            type="button"
            className="ghost-button danger-button"
            onClick={onCancel}
            disabled={isCanceling}
          >
            {isCanceling ? 'Cancelando...' : 'Cancelar cobro'}
          </button>
        ) : null}

        {view.canRetry ? (
          <button
            type="button"
            className="primary-button compact"
            onClick={onRetry}
          >
            Generar otro QR
          </button>
        ) : null}

        {view.canConfirm ? (
          <button
            type="button"
            className="primary-button compact"
            onClick={onConfirm}
            disabled={isConfirming}
          >
            {isConfirming ? 'Confirmando...' : 'Confirmar egreso'}
          </button>
        ) : null}
      </div>
    </div>
  );
}
