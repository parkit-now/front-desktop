/** Base URL of the local camera microservice (`services/camera`, port 8766 by default). */
export const CAMERA_BASE_URL = 'http://127.0.0.1:8766';

/**
 * Cuánto se achica la foto antes de subirla a la nube.
 *
 * Una vez que el LPR leyó la patente, la imagen sólo se usa para auditar a
 * ojo — no hay ninguna automatización que la vuelva a procesar — así que la
 * calidad original no aporta nada.
 *
 * Medido sobre 60 capturas reales, con la legibilidad verificada a ojo sobre
 * el peor caso (cámara de 2560x1440, patente de 317 px):
 *
 *     original, calidad 85      206 KB medio / 488 KB máx   nítida
 *     1280 / 55                  57 KB medio /  76 KB máx   nítida       <- esto
 *     800 / 55                   30 KB medio /  39 KB máx   algo blanda
 *     640 / 40                   18 KB medio /  23 KB máx   se nota el JPEG
 *
 * A 1280/55 la foto COMPLETA pesa menos en el peor caso que el recorte de la
 * patente que se subía antes (102 KB máx), así que el bucket ni se entera.
 *
 * Es política de lo que la nube quiere, no del servicio de cámara: vive acá
 * para poder cambiarla sin reempaquetar el binario de Python.
 */
export const LPR_CLOUD_IMAGE_MAX_WIDTH = 1280;
export const LPR_CLOUD_IMAGE_QUALITY = 55;
