import { useLayoutEffect, useRef, type ComponentProps } from 'react';

/**
 * `<img>` para el stream MJPEG del servicio de cámara que corta la conexión al
 * desmontarse.
 *
 * El stream no termina nunca, y Chromium no siempre cancela la descarga de un
 * `<img>` que sale del DOM: la conexión queda abierta hasta que la junta el GC.
 * Chromium permite 6 conexiones por host, y contra `127.0.0.1:8766` ya va una
 * fija (el EventSource de detecciones). Con unas cuantas idas y vueltas a la
 * pestaña Cámara o a Configurar cámara se llenaban las 6: el `<img>` nuevo
 * quedaba encolado para siempre —en negro, sin `onError`— y el poll de
 * `/stream/status` se encolaba detrás, así que la UI seguía diciendo que todo
 * andaba bien. Solo se arreglaba reiniciando la app.
 *
 * Sacar el atributo `src` aborta la descarga sin disparar `error` (sí lo
 * dispararía asignar `src = ''`).
 */
export function MjpegImage({ ref, src, ...props }: ComponentProps<'img'>) {
  const innerRef = useRef<HTMLImageElement | null>(null);

  useLayoutEffect(() => {
    const img = innerRef.current;
    // StrictMode limpia y vuelve a montar el efecto sin recrear el <img>.
    // La segunda pasada debe reabrir el stream que la limpieza acaba de cortar.
    if (img && src) img.setAttribute('src', src);
    return () => {
      img?.removeAttribute('src');
    };
  }, [src]);

  return (
    <img
      {...props}
      src={src}
      ref={(node) => {
        innerRef.current = node;
        if (typeof ref === 'function') return ref(node);
        if (ref) ref.current = node;
      }}
    />
  );
}
