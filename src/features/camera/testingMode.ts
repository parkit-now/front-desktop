import { useSyncExternalStore } from 'react';

/**
 * Modo prueba de la cámara: muestra en Operativo una tarjeta por CADA patente
 * detectada, sin los descartes de siempre (auto adentro, salida reciente,
 * tarjeta repetida, cooldown del servicio).
 *
 * Existe porque para probar una instalación se pasa el mismo auto una y otra
 * vez, y eso es exactamente lo que la supresión está hecha para esconder: la
 * detección funcionaba, pero la tarjeta no aparecía y parecía que la cámara no
 * leía nada.
 *
 * Es de ESTE equipo, no del estacionamiento, igual que la impresora: se prende
 * para probar una cámara puntual y no tiene por qué viajar a otras cajas.
 *
 * Del lado del servicio el modo vence solo si la app deja de reafirmarlo (ver
 * `_testing_mode` en `services/camera/main.py`), así que cerrar la app lo apaga
 * ahí aunque acá quede guardado. Lo que sigue prendido se ve: Operativo muestra
 * un aviso mientras dure.
 */
const STORAGE_KEY = 'parkit.desktop.camera.testingMode';
const CHANGE_EVENT = 'parkit:camera-testing-mode';

type TestingModeStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function browserStorage(): TestingModeStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readCameraTestingMode(
  storage: TestingModeStorage | null = browserStorage(),
): boolean {
  try {
    return storage?.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeCameraTestingMode(
  enabled: boolean,
  storage: TestingModeStorage | null = browserStorage(),
): void {
  try {
    if (enabled) storage?.setItem(STORAGE_KEY, '1');
    else storage?.removeItem(STORAGE_KEY);
  } catch {
    // Sin storage el modo no persiste, pero el aviso de abajo igual dispara.
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }
}

function subscribe(onChange: () => void): () => void {
  // `storage` cubre otra ventana del mismo origen; el evento propio, esta.
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) onChange();
  };
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener('storage', onStorage);
  };
}

export function useCameraTestingMode(): boolean {
  return useSyncExternalStore(subscribe, () => readCameraTestingMode());
}
