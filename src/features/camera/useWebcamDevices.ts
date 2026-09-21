import { useCallback, useEffect, useState } from 'react';

export interface WebcamDevice {
  /** Índice con el que OpenCV la abre: la POSICIÓN en la lista. Ver abajo. */
  index: number;
  label: string;
}

export interface WebcamDevices {
  devices: WebcamDevice[];
  /** `false` cuando no se pudieron leer los nombres reales. */
  labelled: boolean;
  loading: boolean;
  refresh: () => void;
}

/**
 * Las webcams del equipo, para elegir cuál usa el servicio de detección.
 *
 * POR QUÉ EL ÍNDICE ES UNA POSICIÓN Y NO UN IDENTIFICADOR
 *
 * Son dos mundos que no se hablan: OpenCV abre cámaras por índice y no expone
 * sus nombres; el navegador expone `deviceId` y nombre, y no expone el índice de
 * OpenCV. No hay forma de traducir uno en el otro, así que se asume que el orden
 * coincide — lo habitual, pero no una garantía. En Linux, v4l2 a veces publica
 * dos nodos por cámara y corre todo un lugar.
 *
 * Por eso el botón "Probar" no es decorativo en esta pantalla: es lo único que
 * confirma que el nombre elegido abre de verdad.
 *
 * POR QUÉ PUEDE NO HABER NOMBRES
 *
 * `enumerateDevices()` devuelve el `label` vacío mientras no haya permiso de
 * cámara, y el permiso se consigue abriendo una con `getUserMedia`. Si el
 * servicio de detección ya tiene tomada la webcam —el estado normal cuando estás
 * justamente en modo webcam— esa apertura falla y nos quedamos sin nombres.
 *
 * En ese caso NO se rompe nada: se listan igual las cámaras que hay, numeradas,
 * y `labelled` queda en `false` para que el panel lo explique.
 */
export function useWebcamDevices(enabled: boolean): WebcamDevices {
  const [devices, setDevices] = useState<WebcamDevice[]>([]);
  const [labelled, setLabelled] = useState(false);
  const [loading, setLoading] = useState(false);
  const [token, setToken] = useState(0);

  const refresh = useCallback(() => setToken((value) => value + 1), []);

  useEffect(() => {
    if (!enabled) return;
    if (typeof navigator === 'undefined' || !navigator.mediaDevices) return;

    let mounted = true;
    setLoading(true);

    async function load(): Promise<void> {
      // Se pide permiso y se corta el stream en el acto: solo queríamos
      // desbloquear los nombres, no quedarnos con la cámara ocupada.
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
        });
        stream.getTracks().forEach((track) => track.stop());
      } catch {
        // Dispositivo ocupado o permiso denegado: seguimos sin nombres.
      }

      let inputs: MediaDeviceInfo[] = [];
      try {
        const all = await navigator.mediaDevices.enumerateDevices();
        inputs = all.filter((device) => device.kind === 'videoinput');
      } catch {
        inputs = [];
      }

      if (!mounted) return;

      const named = inputs.every((device) => device.label.length > 0);
      setLabelled(named && inputs.length > 0);
      setDevices(
        inputs.map((device, index) => ({
          index,
          label: device.label || `Cámara ${index + 1}`,
        })),
      );
      setLoading(false);
    }

    void load();
    return () => {
      mounted = false;
    };
  }, [enabled, token]);

  return { devices, labelled, loading, refresh };
}
