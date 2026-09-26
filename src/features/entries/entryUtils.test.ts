import { describe, expect, it } from 'vitest';
import {
  computeChange,
  isCashCovered,
  isCashMethod,
  isMercadoPagoMethod,
  qrChargeBlockReason,
} from './entryUtils';

describe('entryUtils', () => {
  describe('isCashCovered', () => {
    it('sin monto recibido no se puede confirmar', () => {
      expect(isCashCovered(5200, 0)).toBe(false);
    });

    it('con menos del total no, con el total justo o más sí', () => {
      expect(isCashCovered(5200, 5000)).toBe(false);
      expect(isCashCovered(5200, 5200)).toBe(true);
      expect(isCashCovered(5200, 6000)).toBe(true);
    });

    it('con $0 a cobrar no hay nada que recibir', () => {
      expect(isCashCovered(0, 0)).toBe(true);
    });
  });

  describe('computeChange', () => {
    it('returns the difference when received exceeds the amount due', () => {
      expect(computeChange(1500, 2000)).toBe(500);
    });

    it('returns zero when received equals the amount due', () => {
      expect(computeChange(1500, 1500)).toBe(0);
    });

    it('returns zero when received is below the amount due', () => {
      expect(computeChange(1500, 1000)).toBe(0);
    });
  });

  /**
   * EL ARQUEO DE CAJA — camino del dinero.
   *
   * Esta función decide qué cobro entró al cajón. Si se equivoca, el operador
   * cierra el turno con un faltante que no existe (o sin uno que sí) y se lo
   * comen él o el dueño.
   *
   * Antes decidía por el NOMBRE (`name.includes('efectivo')`). Se "arregló"
   * una vez renombrando los métodos del sistema a español, y ese fix se mergeó
   * sin un solo test que avisara si volvía. Estos son esos tests.
   */
  describe('isCashMethod', () => {
    describe('decide por el TIPO, que es el snapshot del cobro', () => {
      it('cash es efectivo, se llame como se llame', () => {
        expect(isCashMethod('cash', 'Efectivo')).toBe(true);
      });

      it('transfer y other no lo son', () => {
        expect(isCashMethod('transfer', 'Transferencia')).toBe(false);
        expect(isCashMethod('other', 'Tarjeta')).toBe(false);
      });
    });

    describe('los dos casos que rompían con la regla vieja', () => {
      it('ESTE es el bug: un efectivo renombrado a "Caja" se sigue contando', () => {
        // El dueño tiene todo el derecho de llamarlo como quiera. Antes, acá
        // desaparecía la plata del arqueo.
        expect(isCashMethod('cash', 'Caja')).toBe(true);
        expect(isCashMethod('cash', 'Contado')).toBe(true);
        expect(isCashMethod('cash', 'Mostrador')).toBe(true);
      });

      it('la otra mitad: "Efectivo Mercado Pago" type=other NO es efectivo', () => {
        // Esa plata está en MP, no en el cajón. Antes el arqueo se la
        // reclamaba al operador.
        expect(isCashMethod('other', 'Efectivo Mercado Pago')).toBe(false);
      });
    });

    describe('fallback por nombre, sólo cuando NO hay tipo', () => {
      // Cubre la ventana entre el upgrade de Dexie (v13) y el primer pull, y
      // el caso del equipo offline. Sin esto el efectivo desaparecería del
      // arqueo justo en esa ventana — el mismo bug, como carrera.
      it('sin tipo, cae en la regla vieja', () => {
        expect(isCashMethod(undefined, 'Efectivo')).toBe(true);
        expect(isCashMethod(undefined, 'EFECTIVO')).toBe(true);
        expect(isCashMethod(undefined, 'Efectivo caja chica')).toBe(true);
        expect(isCashMethod(undefined, 'Tarjeta')).toBe(false);
        expect(isCashMethod(undefined, 'Transferencia')).toBe(false);
      });

      it('el tipo SIEMPRE le gana al nombre, nunca al revés', () => {
        // Es lo que hace que el fallback sea seguro: sólo puede AGREGAR
        // efectivo invisible, nunca contradecir un tipo explícito.
        expect(isCashMethod('other', 'Efectivo')).toBe(false);
        expect(isCashMethod('cash', 'Tarjeta')).toBe(true);
      });
    });
  });
  /**
   * COBRO CON QR — las precondiciones, que son lo único que separa al operario
   * de una pantalla de espera que no va a terminar nunca.
   */
  describe('isMercadoPagoMethod', () => {
    it('discrimina por TIPO y no por nombre, en las dos direcciones', () => {
      // El caso que justifica la función: el dueño anota en un medio
      // `other` las transferencias que le entran por la app y lo llama
      // "Mercado Pago". No hay ninguna cuenta vinculada detrás. Si esto
      // devolviera `true`, el operario se comería una espera por un pago que
      // nadie encoló nunca.
      expect(isMercadoPagoMethod({ type: 'other', name: 'Mercado Pago' })).toBe(
        false,
      );
      expect(
        isMercadoPagoMethod({ type: 'other', name: 'Mercado Pago QR' }),
      ).toBe(false);

      // Y al revés: el medio real renombrado sigue siendo el medio real.
      // `name` es del dueño y lo puede cambiar cuando quiera.
      expect(isMercadoPagoMethod({ type: 'mercadopago_qr', name: 'QR' })).toBe(
        true,
      );
      expect(
        isMercadoPagoMethod({ type: 'mercadopago_qr', name: 'Celular' }),
      ).toBe(true);

      // Sin tipo NO adivinamos por nombre (a diferencia de `isCashMethod`):
      // acá el error seguro es no ofrecer el QR, no ofrecerlo de más.
      expect(
        isMercadoPagoMethod({ type: undefined, name: 'Mercado Pago' }),
      ).toBe(false);
      expect(isMercadoPagoMethod(undefined)).toBe(false);
    });
  });

  describe('qrChargeBlockReason', () => {
    it('sin conexión no se puede cobrar con QR', () => {
      // El cobro vive en Mercado Pago, no en Dexie: no hay camino offline que
      // encolar. Con red y la estadía sincronizada, en cambio, no hay bloqueo.
      expect(qrChargeBlockReason({ isOnline: false, entrySyncSeq: 42 })).toBe(
        'offline',
      );
      expect(
        qrChargeBlockReason({ isOnline: true, entrySyncSeq: 42 }),
      ).toBeNull();

      // Sin red Y sin sincronizar gana 'offline': lo segundo es consecuencia
      // de lo primero y se arregla solo cuando vuelve la conexión.
      expect(qrChargeBlockReason({ isOnline: false, entrySyncSeq: 0 })).toBe(
        'offline',
      );
    });

    it('una estadía todavía no sincronizada tampoco puede cobrarse con QR', () => {
      // `payment_intents.entry_id` tiene FK contra `entries` del SERVIDOR. Una
      // estadía local (nace con `syncSeq: 0`) no existe del otro lado y el
      // POST se estrella contra la FK con un error que no le dice nada a
      // nadie. Con `syncSeq > 0` el servidor ya la conoce.
      expect(qrChargeBlockReason({ isOnline: true, entrySyncSeq: 0 })).toBe(
        'entry-not-synced',
      );
      expect(
        qrChargeBlockReason({ isOnline: true, entrySyncSeq: 1 }),
      ).toBeNull();
    });
  });
});
