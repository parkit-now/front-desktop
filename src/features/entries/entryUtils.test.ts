import { describe, expect, it } from 'vitest';
import { computeChange, isCashMethod } from './entryUtils';

describe('entryUtils', () => {
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
});
