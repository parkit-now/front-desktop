"""Camera capture microservice — FastAPI entry point.

Usage:
    python main.py [PORT]     # defaults to 8766

Environment variables (all optional):
    CAMERA_SOURCE              Device index or RTSP URL             (default: 0)
    CAMERA_FPS                 Target capture FPS                   (default: 10)
    CAMERA_WIDTH               Frame width px                       (default: 1280)
    CAMERA_HEIGHT              Frame height px                      (default: 720)
    CAMERA_ID                  Logical camera identifier            (default: cam-01)
    CAMERA_TENANT_ID           Tenant ID for storage path           (default: default)
    CAMERA_LOCATION            "entrada" | "salida"                 (default: entrada)
    CAMERA_MOTION_THRESHOLD    Mean pixel diff [0–255] to trigger   (default: 1.5)
    CAMERA_MOTION_COOLDOWN     Seconds between motion triggers      (default: 1.5)
    CAMERA_ROI                 "x1,y1,x2,y2" px, empty=full frame  (default: "")
    CAMERA_FALLBACK_INTERVAL   Seconds between fallback LPR scans  (default: 300)
    CAMERA_MIN_CONFIDENCE      Minimum confidence to save [0–1]     (default: 0.60)
    CAMERA_COOLDOWN            Seconds before saving same plate again (default: 60)
    CAMERA_CLUSTER_WINDOW      Seconds to merge similar detections  (default: 5)
    CAMERA_CLUSTER_SETTLE      Quiet time before saving a cluster   (default: 1.2)
    CAMERA_PLATE_MERGE_DISTANCE  Letras que pueden diferir y ser la misma (default: 3)
    CAMERA_MOVE_MAX_RATIO      Movimiento máx entre lecturas, de la diagonal (default: 0.15)
    CAMERA_DB_PATH             SQLite database path                 (default: ./camera.db)
    CAMERA_IMAGES_DIR          Base directory for images            (default: ./images)
    CAMERA_WATCHDOG_TIMEOUT    Seconds without frames before reconnect (default: 5)
    LPR_URL                    LPR service base URL                 (default: http://127.0.0.1:8765)
"""

import asyncio
import hmac
import json
import logging
import os
import re
import sys
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from contextlib import suppress
from datetime import datetime, timezone

import cv2
import uvicorn
from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response, StreamingResponse

import lpr_client
from capture import CameraCapture, redact_source
from motion import MotionDetector, roi_crop
from storage import LocalStorage
from ignored_plates import is_ignored, normalize_plate, parse_snapshot
from watchdog import CameraWatchdog

def _force_utf8_stdio(streams) -> None:
    r"""Escribir en UTF-8 pase lo que pase, sin depender del entorno.

    EL BUG QUE ESTO CIERRA

    En Windows, este servicio arrancaba y se moría en el acto, tres veces
    seguidas, y en el Administrador de tareas no quedaba nada. El LPR, al lado,
    andaba perfecto. El log tenía esto:

        File "main.py", line 176, in _print_banner
        File "encodings\cp1252.py", line 19, in encode
        UnicodeEncodeError: 'charmap' codec can't encode characters in
        position 0-59: character maps to <undefined>

    Posición 0-59 son los 60 guiones `─` del separador del banner. La consola
    de Windows en español usa cp1252, que no los tiene, y la excepción sube por
    el `lifespan` de Starlette: la aplicación no llega a arrancar y el proceso
    termina. El LPR sobrevivía sólo porque imprime ASCII puro.

    POR QUÉ NO ALCANZABA CON LAS VARIABLES DE ENTORNO

    Electron ya le pasa `PYTHONUTF8=1` y `PYTHONIOENCODING=utf-8` justamente
    para esto. **El binario de PyInstaller las ignora**: el bootloader arranca
    el intérprete en modo aislado, así que no lee esas variables. En desarrollo
    (`python main.py`) sí funcionan, y por eso esto nunca se vio local — sólo
    rompía en el instalador.

    La solución tiene que ser código en tiempo de ejecución, no configuración
    del entorno. Va ANTES de cualquier `print` o `logging`, porque si no el
    primero que salga se lleva puesto al proceso.

    `errors="replace"` como red: si algo raro igual no se puede codificar, sale
    un carácter de reemplazo y no una excepción. Perder un acento en un log
    nunca puede tirar abajo la detección de patentes.
    """
    for stream in streams:
        # En un build "windowed" de PyInstaller no hay consola y `sys.stdout`
        # puede ser None; y un stream capturado por un test puede no soportar
        # `reconfigure`.
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is None:
            continue
        try:
            reconfigure(encoding="utf-8", errors="replace")
        except (ValueError, OSError):
            # Un stream ya cerrado o sin buffer de texto. No es motivo para no
            # arrancar el servicio.
            pass


_force_utf8_stdio((sys.stdout, sys.stderr))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)
logging.getLogger("uvicorn.access").setLevel(logging.WARNING)

# ── Config ────────────────────────────────────────────────────────────────────


def _port_from_argv() -> int:
    """El puerto sale del primer argumento, si es que ese argumento es un puerto.

    Antes esto era `int(sys.argv[1])` pelado, y rompía de dos formas:

      * Bajo pytest, `sys.argv[1]` es la ruta de un test. El `ValueError`
        saltaba AL IMPORTAR el módulo, así que no se podía escribir un solo
        test de este archivo.
      * `python main.py --reload` moría con un `ValueError` sin contexto.

    Un argumento que no es un número no es un puerto: se ignora y se usa el
    default, que es lo que el que escribió `--reload` esperaba.
    """
    if len(sys.argv) > 1:
        try:
            return int(sys.argv[1])
        except ValueError:
            pass
    return 8766


PORT             = _port_from_argv()
SHUTDOWN_TOKEN   = os.environ.get("PARKIT_SHUTDOWN_TOKEN")
CAMERA_SOURCE    = os.environ.get("CAMERA_SOURCE", "0")
CAMERA_FPS       = int(os.environ.get("CAMERA_FPS", "10"))
CAMERA_WIDTH     = int(os.environ.get("CAMERA_WIDTH", "1280"))
CAMERA_HEIGHT    = int(os.environ.get("CAMERA_HEIGHT", "720"))
CAMERA_ID        = os.environ.get("CAMERA_ID", "cam-01")
CAMERA_TENANT_ID = os.environ.get("CAMERA_TENANT_ID", "default")
CAMERA_LOCATION  = os.environ.get("CAMERA_LOCATION", "entrada")
# Umbral de "esto hay que verificarlo a ojo": enciende el aviso ⚠ del panel y
# baja el candidato en el ranking del grupo (`_quality_score`).
#
# Estaba en 0,60, que es el piso del rango útil, así que el aviso casi nunca
# aparecía cuando tenía que aparecer. Los datos de producción muestran que la
# relación descarte/acierto se da vuelta exactamente en 0,85: por debajo hay 11
# descartes por cada registro, por encima la mayoría son buenas.
# Versión del build. Electron la pasa por entorno y la compara al arrancar
# para distinguir un servicio suyo de uno que sobrevivió a una actualización.
#
# EL BUG QUE ESTO ARREGLA
#
# Al arrancar, Electron pregunta por `/health` y si algo responde lo ADOPTA en
# vez de lanzar uno nuevo — pensado para desarrollo, donde uno corre el
# servicio a mano. Pero si un servicio viejo sobrevivía al cierre (pasaba en
# Windows: ver `forceKillTree` en electron/services.ts), la versión NUEVA de la
# app adoptaba al proceso VIEJO y seguía corriendo código viejo sin avisar.
# Encima lo marcaba como adoptado —"no lo cierres al salir"— así que se quedaba
# para siempre reteniendo el puerto y la conexión con la cámara.
BUILD_VERSION = os.environ.get("PARKIT_BUILD_VERSION", "dev")

MIN_CONFIDENCE   = float(os.environ.get("CAMERA_MIN_CONFIDENCE", "0.85"))
# Cuánto espera antes de volver a guardar la MISMA patente, en memoria.
#
# Es la red que cubre el viaje de ida y vuelta al renderer: entre que este
# servicio persiste un evento y el renderer lo ve (poll de 2 s) y lo devuelve
# en la lista de patentes conocidas (cada 10 s) pasan hasta ~12 s, y en ese
# hueco una segunda lectura del mismo auto generaría una tarjeta duplicada.
#
# Vive en memoria a propósito: muere con el proceso y por eso NO PUEDE quedar
# desactualizada, que es justamente lo que rompió la versión anterior de esta
# supresión cuando la leía de la base.
COOLDOWN         = float(os.environ.get("CAMERA_COOLDOWN", "60.0"))
CLUSTER_WINDOW   = float(os.environ.get("CAMERA_CLUSTER_WINDOW", "5.0"))
CLUSTER_SETTLE   = float(os.environ.get("CAMERA_CLUSTER_SETTLE", "1.2"))
# Cuántas letras puede errar el OCR y seguir siendo la misma patente, y cuánto
# puede moverse esa patente entre dos lecturas (fracción de la diagonal del
# cuadro analizado). Ver `_plates_similar` y `_bbox_close`.
PLATE_MERGE_DISTANCE = int(os.environ.get("CAMERA_PLATE_MERGE_DISTANCE", "3"))
MOVE_MAX_RATIO   = float(os.environ.get("CAMERA_MOVE_MAX_RATIO", "0.15"))
DB_PATH          = os.environ.get("CAMERA_DB_PATH", "./camera.db")
IMAGES_DIR       = os.environ.get("CAMERA_IMAGES_DIR", "./images")
WATCHDOG_TIMEOUT = int(os.environ.get("CAMERA_WATCHDOG_TIMEOUT", "5"))
# Cuántos días se conservan las capturas en el disco de ESTE equipo. La copia
# que se audita vive en la nube con la retención que configura el dueño; acá
# sólo hace falta aguantar un corte de conexión largo. Ver
# `LocalStorage.purge_images_older_than`: nunca borra algo sin subir.
IMAGE_RETENTION_DAYS = int(os.environ.get("CAMERA_IMAGE_RETENTION_DAYS", "14"))

MOTION_THRESHOLD  = float(os.environ.get("CAMERA_MOTION_THRESHOLD", "1.5"))
# 1,5 s y no 3,0: con 3,0 un auto que entra daba UNA sola lectura, así que no
# había con qué comparar y el agrupamiento no tenía material. Además fija el
# piso de CLUSTER_SETTLE (ver `_coherent_cluster_timing`), y con 3,0 la tarjeta
# tardaba hasta 8,5 s en aparecer. El costo es el doble de inferencias: medido,
# la inferencia tarda 0,02-0,07 s, o sea ~5 % de un núcleo.
MOTION_COOLDOWN   = float(os.environ.get("CAMERA_MOTION_COOLDOWN", "1.5"))
FALLBACK_INTERVAL = float(os.environ.get("CAMERA_FALLBACK_INTERVAL", "300.0"))

# Piso duro de confianza: por debajo de esto el grupo ni se guarda ni se le
# muestra al operador.
#
# POR QUÉ EXISTE
#
# Hasta ahora NO había ningún piso. `MIN_CONFIDENCE` sólo escribía la etiqueta
# `low_confidence` y la detección se publicaba igual, así que al operador le
# llegaba TODA lectura que devolviera el LPR, incluso con 17% de confianza. En
# producción eso dio 285 descartes contra 89 registros.
#
# Los datos dicen dónde cortar: de 158 lecturas por debajo de 0,60, **147
# terminaron descartadas a mano** (93%). Las 11 que sí sirvieron son el precio,
# y es barato comparado con 147 tarjetas de ruido que alguien tiene que cerrar
# una por una.
#
# Se aplica al MEJOR candidato del grupo, no a cada lectura: el agrupamiento ya
# se queda con la mejor de varias miradas al mismo auto, así que lo que importa
# es si el mejor intento sirvió para algo.
DISCARD_BELOW  = float(os.environ.get("CAMERA_DISCARD_BELOW", "0.60"))

STREAM_FPS     = max(1, min(CAMERA_FPS, int(os.environ.get("CAMERA_STREAM_FPS", "12"))))
# Ancho máximo del preview. El MJPEG codificaba el cuadro ENTERO —2560×1440 en
# una cámara de 4 MP— diez veces por segundo. A 960 px cuesta ~7 veces menos y
# en un panel de escritorio no se nota la diferencia. 0 = no achicar.
STREAM_MAX_WIDTH = int(os.environ.get("CAMERA_STREAM_MAX_WIDTH", "960"))
# Variable propia y no un literal dentro de _STREAM_JPEG: el panel la ajusta en
# caliente, y para eso tiene que poder leerse y escribirse por nombre.
STREAM_QUALITY = int(os.environ.get("CAMERA_STREAM_QUALITY", "70"))
_STREAM_JPEG   = [cv2.IMWRITE_JPEG_QUALITY, STREAM_QUALITY]


def _parse_roi(raw: str) -> tuple[int, int, int, int] | None:
    raw = raw.strip()
    if not raw:
        return None
    try:
        x1, y1, x2, y2 = (int(p) for p in raw.split(","))
    except ValueError:
        raise ValueError(
            f"CAMERA_ROI must be 'x1,y1,x2,y2' (integers), got: {raw!r}"
        )
    if x1 >= x2 or y1 >= y2:
        raise ValueError(f"CAMERA_ROI: x1 < x2 and y1 < y2 required, got: {raw!r}")
    return x1, y1, x2, y2


ROI = _parse_roi(os.environ.get("CAMERA_ROI", ""))

_BAR_WIDTH = 20


def _conf_bar(confidence: float) -> str:
    filled = int(confidence * _BAR_WIDTH)
    return "█" * filled + "░" * (_BAR_WIDTH - filled)


def _ts() -> str:
    return time.strftime("%H:%M:%S")


def _print_banner() -> None:
    roi_label = f"{ROI}" if ROI else "full frame"
    w = 60
    sep = "─" * w
    print(sep)
    print(f"  Parkit — Camera Service")
    print(sep)
    print(f"  camera   : {CAMERA_ID}  (source: {redact_source(CAMERA_SOURCE)})")
    print(f"  location : {CAMERA_LOCATION}  |  tenant: {CAMERA_TENANT_ID}")
    print(f"  LPR      : {lpr_client.LPR_URL}")
    print(f"  storage  : {IMAGES_DIR}  |  {DB_PATH}")
    print(f"  motion   : threshold={MOTION_THRESHOLD}  cooldown={MOTION_COOLDOWN}s  roi={roi_label}")
    print(f"  fallback : every {FALLBACK_INTERVAL:.0f}s")
    print(
        f"  filter   : min_conf={MIN_CONFIDENCE:.0%}  discard_below={DISCARD_BELOW:.0%}"
        f"  plate_cooldown={COOLDOWN}s"
    )
    # Que el banner diga si la aceleración por hardware está pedida. No dice si
    # la GPU la concedió —OpenCV cae a software en silencio y no lo reporta—,
    # pero al menos separa "no la pedí" de "la pedí y no sirvió", que sin esto
    # son indistinguibles desde afuera.
    hw = "off" if os.environ.get("CAMERA_HW_ACCEL", "1") == "0" else "requested"
    print(f"  decode   : hw_accel={hw}  (CAMERA_HW_ACCEL=0 para apagarla)")
    # Los valores EFECTIVOS, ya clampeados: si el banner mostrara lo pedido y
    # el servicio corriera con otra cosa, no habría forma de darse cuenta.
    print(
        f"  cluster  : window={CLUSTER_WINDOW:.1f}s  settle={CLUSTER_SETTLE:.1f}s"
        f"  merge_dist={PLATE_MERGE_DISTANCE}  move_max={MOVE_MAX_RATIO}"
    )
    print(f"  API      : http://127.0.0.1:{PORT}")
    print(sep)
    print()


# ── Service instances (initialised in lifespan) ───────────────────────────────

_capture:      CameraCapture  | None = None
_storage:      LocalStorage   | None = None
_watchdog:     CameraWatchdog | None = None
_motion:       MotionDetector | None = None
_lpr_executor: ThreadPoolExecutor | None = None

# Patentes que YA están adentro del estacionamiento, según el renderer.
#
# El servicio de cámara no tiene forma de saberlo solo: eso vive en Dexie, del
# otro lado. El renderer lo empuja con POST /known-plates aprovechando el poll
# que ya hace cada 2 s.
#
# Tiene vencimiento a propósito. Si el renderer se cae o se queda colgado, el
# conjunto se vacía y se vuelve al comportamiento de antes —guardar de más—, en
# vez de quedarse suprimiendo para siempre contra una lista congelada, que
# sería un auto que nunca se registra y nadie sabe por qué.
_KNOWN_PLATES_TTL = 30.0
_known_plates_value: set[str] = set()
_known_plates_at: float = 0.0
_ignored_plate_snapshot: dict = {"tenantId": None, "ignoredPlates": []}


def _known_plates() -> set[str]:
    if not _known_plates_value:
        return set()
    if time.monotonic() - _known_plates_at > _KNOWN_PLATES_TTL:
        return set()
    return _known_plates_value


# Modo prueba: el renderer lo prende desde Configurar cámara para poder probar
# siempre con el mismo auto. Con él no se descarta nada: ni las patentes que el
# renderer da por conocidas ni las repetidas dentro de COOLDOWN.
#
# Viaja en el mismo POST /known-plates y vence igual que la lista, a propósito.
# Un modo prueba que quede prendido en producción llena el disco y la cola de
# tarjetas, así que no puede depender de que alguien se acuerde de apagarlo: si
# el renderer deja de reafirmarlo —lo apagaron, se cerró la app, se colgó—, a
# los 30 s el servicio vuelve solo al comportamiento normal.
_testing_mode_at: float | None = None


def _testing_mode() -> bool:
    if _testing_mode_at is None:
        return False
    return time.monotonic() - _testing_mode_at <= _KNOWN_PLATES_TTL


# Ya se avisó que esta cámara corre sin zona de detección. Se rearma al cambiar
# el ROI desde la config, para que el aviso vuelva si lo borran.
_warned_no_roi = False
_server:       uvicorn.Server | None = None
_shutting_down = False

PROCESS_LOOP_SHUTDOWN_TIMEOUT = 3.0


def _require_shutdown_token(token: str | None) -> None:
    if not SHUTDOWN_TOKEN or token is None:
        raise HTTPException(status_code=403, detail="Forbidden")
    if not hmac.compare_digest(token, SHUTDOWN_TOKEN):
        raise HTTPException(status_code=403, detail="Forbidden")

# Last successful detection — read by GET /detection/latest.
_last_detection: dict | None = None
_clusters: list[dict] = []


def _sse_message(event: str, data: dict) -> str:
    payload = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    return f"event: {event}\ndata: {payload}\n\n"


class DetectionEventBroadcaster:
    """Tiny in-memory fan-out for local renderer SSE clients."""

    def __init__(self):
        self._subscribers: set[asyncio.Queue[dict]] = set()

    def subscribe(self) -> asyncio.Queue[dict]:
        queue: asyncio.Queue[dict] = asyncio.Queue(maxsize=100)
        self._subscribers.add(queue)
        return queue

    def unsubscribe(self, queue: asyncio.Queue[dict]) -> None:
        self._subscribers.discard(queue)

    def publish(self, event: dict) -> None:
        stale: list[asyncio.Queue[dict]] = []
        for queue in list(self._subscribers):
            try:
                queue.put_nowait(event)
            except asyncio.QueueFull:
                stale.append(queue)
        for queue in stale:
            self.unsubscribe(queue)


_detection_events = DetectionEventBroadcaster()

# Plate-level deduplication state.
_last_saved_by_plate: dict[str, float] = {}


def _iso_from_monotonic(monotonic_ts: float) -> str:
    delta = time.monotonic() - monotonic_ts
    return datetime.fromtimestamp(time.time() - delta, timezone.utc).isoformat()


def _levenshtein(a: str, b: str) -> int:
    if a == b:
        return 0
    if not a:
        return len(b)
    if not b:
        return len(a)
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(
                min(
                    cur[j - 1] + 1,
                    prev[j] + 1,
                    prev[j - 1] + (0 if ca == cb else 1),
                )
            )
        prev = cur
    return prev[-1]


def _substring_distance(needle: str, haystack: str) -> int:
    """Menor levenshtein entre `needle` y CUALQUIER tramo contiguo de `haystack`.

    Es levenshtein con los extremos de `haystack` gratis (alineamiento
    semi-global): "G577" contra "IAG574" da 1, porque el mejor tramo es "G574".
    """
    if not needle:
        return 0
    prev = [0] * (len(haystack) + 1)  # arrancar en cualquier columna no cuesta
    for i, cn in enumerate(needle, 1):
        cur = [i]
        for j, ch in enumerate(haystack, 1):
            cur.append(
                min(
                    cur[j - 1] + 1,
                    prev[j] + 1,
                    prev[j - 1] + (0 if cn == ch else 1),
                )
            )
        prev = cur
    return min(prev)  # terminar en cualquier columna tampoco


# Un fragmento de menos caracteres ya no dice a qué patente pertenece: "AB"
# está adentro de miles. Con 3 y a lo sumo 1 error, la chance de que el pedazo
# de OTRA patente caiga justo adentro de la del cluster es baja, y encima tiene
# que pasar el veto de posición.
FRAGMENT_MIN_LEN = 3
FRAGMENT_MAX_DISTANCE = 1


def _is_fragment_of(fragment: dict, full: dict) -> bool:
    """Si `fragment` es un pedazo mal leído de la patente de `full`.

    EL CASO QUE ESTO ARREGLA

    Con la patente chica en el cuadro, el detector a veces ubica mal el
    recuadro: corta la mitad de la patente y agarra lo que hay al lado. El OCR
    lee lo que quedó adentro. Medido en la instalación real: `IAG 574` al 80 %
    y, un segundo después y del mismo auto, `G577` al 55 %. Por texto no se
    agrupaban —son 3 ediciones y `G577` es corta, así que el límite baja a 1—
    y el operador recibía una segunda tarjeta "Verificar patente" con basura.

    Un fragmento NUNCA es una lectura con formato válido: si el OCR leyó una
    patente argentina completa, es una patente, y decidir si es la misma la
    tiene que hacer `_plates_similar`. Esto sólo rescata lecturas que de todas
    formas no se pueden registrar tal cual.
    """
    if fragment.get("formatValid"):
        return False
    a = _normalised(fragment)
    b = _normalised(full)
    if len(a) < FRAGMENT_MIN_LEN or len(a) >= len(b):
        return False
    return _substring_distance(a, b) <= FRAGMENT_MAX_DISTANCE


def _normalised(result: dict) -> str:
    return normalize_plate(result.get("normalizedText") or result.get("text") or "")


def _display_plate(result: dict) -> str:
    return (
        result.get("displayPlate")
        or result.get("plate")
        or _normalised(result)
        or result.get("rawText")
        or ""
    )


def _bbox_tuple(result: dict) -> tuple[int, int, int, int] | None:
    bbox = result.get("bbox")
    if not isinstance(bbox, (list, tuple)) or len(bbox) != 4:
        return None
    try:
        x1, y1, x2, y2 = (int(v) for v in bbox)
    except (TypeError, ValueError):
        return None
    if x1 >= x2 or y1 >= y2:
        return None
    return x1, y1, x2, y2


def _distance_limit_for(shortest: int, max_distance: int) -> int:
    """Cuántas letras distintas se toleran, según lo larga que sea la patente.

    No es lo mismo tolerar 3 errores en una Mercosur de 7 caracteres que en una
    vieja de 6. Probabilidad de que DOS patentes distintas queden a esa
    distancia (Monte Carlo, 400k pares):

        formato              lev<=1     lev<=2     lev<=3
        Mercosur AA000AA          0    7,5e-06    4,0e-04
        vieja    ABC123     5,0e-06    2,6e-04    5,4e-03

    Con un límite plano de 3, las viejas serían 13 veces más colisionables que
    las Mercosur. Escalando por longitud las dos quedan en el mismo orden.

    No es un caso hipotético: 37 de las 132 lecturas de la base de prueba
    (28 %) tienen 6 caracteres. Por debajo de 6 la lectura ya es un fragmento y
    relajar es apostar, así que ahí se vuelve al límite original de 1.
    """
    if shortest >= 7:
        return max_distance
    if shortest == 6:
        return min(max_distance, 2)
    return min(max_distance, 1)


def _plates_similar(a: str, b: str, max_distance: int = 1) -> bool:
    """Si dos lecturas pueden ser la misma patente leída distinto.

    `max_distance` es el tope PEDIDO; el que se aplica sale de
    `_distance_limit_for`, que lo baja para patentes cortas.
    """
    if not a or not b:
        return False
    if a == b:
        return True
    limit = _distance_limit_for(min(len(a), len(b)), max_distance)
    # Corto barato: levenshtein nunca es menor que la diferencia de longitudes,
    # así que si ya se pasa no hace falta calcularlo. Ojo que la constante es
    # `limit` y no un 1 fijo — con un 1 fijo, "AB123" y "AB123CD" se descartaban
    # sin mirar aunque el límite pedido fuera 3.
    if abs(len(a) - len(b)) > limit:
        return False
    return _levenshtein(a, b) <= limit


def _bbox_close(
    a: tuple[int, int, int, int] | None,
    b: tuple[int, int, int, int] | None,
    frame_size: tuple[int, int] | None,
    max_ratio: float,
) -> bool:
    """Si las dos lecturas están donde estaría UN MISMO auto avanzando.

    LA ESCALA ES LA DIAGONAL DEL CUADRO ANALIZADO, NO EL TAMAÑO DE LA PATENTE

    Antes se dividía por el lado mayor de la patente, y eso hacía que el umbral
    dependiera de cuán CERCA estaba el auto en vez de cuánto se MOVIÓ. El
    resultado era que invertía el orden de los dos casos que hay que separar
    (medido sobre detecciones reales):

        par                                  escala patente   escala diagonal
        AB174CU -> AB123CD  (el mismo auto)           0,646             0,122
        AE622RW -> AF692RK  (autos distintos)         0,326             0,189

    O sea que el par bueno "parecía" el doble de lejos que el malo, porque una
    patente medía 853 px y la otra 258. Ningún umbral sobre esa escala separa
    los casos. Sobre la diagonal sí, y con margen a los dos lados.

    El frame de referencia es el que se analizó, que ya viene recortado al ROI.
    """
    if a is None or b is None or frame_size is None:
        return False
    fw, fh = frame_size
    diagonal = (fw * fw + fh * fh) ** 0.5
    if diagonal <= 0:
        return False
    dx = (a[0] + a[2]) / 2 - (b[0] + b[2]) / 2
    dy = (a[1] + a[3]) / 2 - (b[1] + b[3]) / 2
    return ((dx * dx + dy * dy) ** 0.5 / diagonal) <= max_ratio


def _quality_score(candidate: dict) -> float:
    ranks = {
        "valid_high": 4,
        "valid_low": 3,
        "low_confidence": 2,
        "invalid_format": 1,
    }
    result = candidate["result"]
    status = result.get("qualityStatus") or "low_confidence"
    return ranks.get(status, 0) + float(result.get("confidence") or 0)


# El panel repite este número para poder avisar antes de guardar
# (`CAMERA_CLUSTER_SETTLE_MARGIN` en `src/features/camera/cameraSettingsUtils.ts`).
# La autoridad es esta: allá sólo se usa para el texto del aviso.
SETTLE_MARGIN = 0.5


def _coherent_cluster_timing(
    motion_cooldown: float, settle: float, window: float
) -> tuple[float, float]:
    """Sube settle y ventana hasta que agrupar sea POSIBLE.

    EL BUG QUE ESTO ARREGLA

    Un cluster se cierra tras `CLUSTER_SETTLE` de silencio. Pero entre dos
    análisis del mismo auto pasa como mínimo `MOTION_COOLDOWN`, que lo impone
    el detector de movimiento. Con settle (1,2 s) < cooldown (3,0 s) el cluster
    se cerraba SIEMPRE antes de que pudiera llegar un segundo candidato:
    agrupar era imposible por construcción, no por calibración.

    No es teoría. Sobre la base de prueba, de 132 eventos guardados, los que
    tenían más de un candidato eran CERO.

    El margen de 0,5 s sale de los datos: los intervalos reales entre análisis
    tocan piso en 3,0-3,1 s con un cooldown de 3,0, o sea que el tick del loop
    y la inferencia aportan ~0,1 s.

    Se CLAMPEA en vez de devolver 400, igual que STREAM_FPS contra CAMERA_FPS:
    son valores individualmente válidos pero incoherentes entre sí, y el panel
    manda el objeto de ajustes entero. Rechazarlo obligaría al operador a
    resolver a mano una dependencia que el servicio conoce mejor que él.
    """
    settle = max(settle, motion_cooldown + SETTLE_MARGIN)
    # La ventana tiene que alcanzar para dos análisis más el settle del último,
    # o expiraría antes de que el segundo candidato llegue a sumarse.
    window = max(window, 2.0 * motion_cooldown + SETTLE_MARGIN, settle + motion_cooldown)
    return settle, window


def _candidate_snapshot(candidate: dict) -> dict:
    result = candidate["result"]
    return {
        "seenAt": _iso_from_monotonic(candidate["seen_at"]),
        "rawText": result.get("rawText"),
        "normalizedText": _normalised(result),
        "displayPlate": _display_plate(result),
        "confidence": float(result.get("confidence") or 0),
        "formatValid": bool(result.get("formatValid")),
        "formatType": result.get("formatType") or "unknown",
        "qualityStatus": result.get("qualityStatus") or "low_confidence",
        "bbox": list(candidate["bbox"]) if candidate["bbox"] else None,
        # Sin esto, el bbox de arriba no se puede normalizar después: para
        # recalibrar MOVE_MAX_RATIO hubo que abrir los JPEG del disco uno por
        # uno y leerles el tamaño.
        "frameSize": list(candidate["frame_size"]),
    }


def _candidate_distance(a: dict, b: dict) -> float:
    """Distancia entre dos lecturas, en fracciones de la diagonal del cuadro."""
    fw, fh = a["frame_size"]
    diagonal = (fw * fw + fh * fh) ** 0.5
    if diagonal <= 0:
        return float("inf")
    ab, bb = a["bbox"], b["bbox"]
    dx = (ab[0] + ab[2]) / 2 - (bb[0] + bb[2]) / 2
    dy = (ab[1] + ab[3]) / 2 - (bb[1] + bb[3]) / 2
    return ((dx * dx + dy * dy) ** 0.5) / diagonal


def _cluster_matches(cluster: dict, candidate: dict, now: float) -> float | None:
    """Distancia al cluster si el candidato es el mismo auto, o None.

    EL ANCLA ES EL ÚLTIMO CANDIDATO, NO EL MEJOR

    Un auto que avanza se aleja monótonamente. Si el ancla quedara clavada en
    `best` —que puede ser la primera lectura— la tercera lectura estaría a DOS
    pasos de ella y superaría cualquier umbral calibrado sobre UN paso. El
    0,15 de `MOVE_MAX_RATIO` es un límite por paso, así que encadenar contra el
    último es lo único consistente con ese número.

    EL CRITERIO ES «Y», NO «O» — Y ESTO ES LO QUE MÁS IMPORTA DE ACÁ

    Antes era `_plates_similar(...) or _bbox_close(...)`. No se notaba porque el
    agrupamiento estaba muerto (ver `_coherent_cluster_timing`), pero en cuanto
    empieza a correr, ese `or` fusiona patentes sin ninguna relación por sola
    cercanía. Medido sobre detecciones reales separadas por 3 segundos:

        AH000BO vs AB174CU   levenshtein 6   pero a 0,042 de diagonal  -> UNÍA

    Se perdía una patente entera. Con `and`, el texto tiene que dar el visto
    bueno primero y la posición actúa de VETO, no de evidencia: en estos datos
    la posición sola fusionaba casi todo, porque todos los autos cruzan por la
    misma boca del portón.

    Hasta 1 carácter de diferencia el texto alcanza solo: una relectura de la
    misma patente puede pasar mientras el auto se mueve bastante, y a esa
    distancia la probabilidad de que sean dos patentes distintas es ~0.
    """
    if now - cluster["first_seen"] > CLUSTER_WINDOW:
        return None
    anchor = cluster["candidates"][-1]
    # Cambió la fuente a mitad del cluster: las coordenadas de un frame no
    # significan nada en el otro.
    if anchor["frame_size"] != candidate["frame_size"]:
        return None
    a = _normalised(anchor["result"])
    b = _normalised(candidate["result"])
    if _plates_similar(a, b, max_distance=1):
        return _candidate_distance(anchor, candidate)
    # Fragmentos: el texto se compara también contra `best`, porque el ancla
    # puede ser otro fragmento ("G577" y después "AG57"). La posición sigue
    # siendo contra el ancla, como en el resto: es la que acompaña al auto.
    reference = cluster["best"]["result"]
    fragment = (
        _is_fragment_of(candidate["result"], anchor["result"])
        or _is_fragment_of(anchor["result"], candidate["result"])
        or _is_fragment_of(candidate["result"], reference)
    )
    if not fragment and not _plates_similar(a, b, max_distance=PLATE_MERGE_DISTANCE):
        return None
    if not _bbox_close(
        anchor["bbox"], candidate["bbox"], candidate["frame_size"], MOVE_MAX_RATIO
    ):
        return None
    return _candidate_distance(anchor, candidate)


def _add_cluster_candidate(result: dict, frame, now: float) -> None:
    candidate = {
        "result": result,
        "frame": frame.copy(),
        "bbox": _bbox_tuple(result),
        "frame_size": (frame.shape[1], frame.shape[0]),
        "seen_at": now,
    }
    if candidate["bbox"] is None:
        return
    # El MEJOR match, no el primero. Con varios clusters abiertos —que ahora
    # pasa seguido— quedarse con el primero de la lista es una lotería: el
    # orden es de inserción, no de parecido.
    best_cluster = None
    best_distance = float("inf")
    for cluster in _clusters:
        distance = _cluster_matches(cluster, candidate, now)
        if distance is not None and distance < best_distance:
            best_cluster, best_distance = cluster, distance
    if best_cluster is not None:
        best_cluster["last_seen"] = now
        best_cluster["candidates"].append(candidate)
        if _quality_score(candidate) > _quality_score(best_cluster["best"]):
            best_cluster["best"] = candidate
        return
    _clusters.append(
        {
            "first_seen": now,
            "last_seen": now,
            "best": candidate,
            "candidates": [candidate],
        }
    )


def _persist_cluster(cluster: dict) -> dict | None:
    global _last_detection, _last_saved_by_plate

    if _storage is None:
        return None

    best = cluster["best"]
    result = best["result"]
    normalized = _normalised(result)
    bbox = best["bbox"]
    if bbox is None:
        return None

    # ── Piso de confianza ─────────────────────────────────────────────────────
    #
    # Si ni el mejor candidato del grupo llega al piso, no se guarda la imagen
    # ni se publica el evento: el auto no se detectó, y el operador tipea la
    # patente como lo haría sin cámara.
    #
    # Va acá y no en el loop de detección a propósito. El grupo junta varias
    # miradas al mismo auto mientras se acerca, y las primeras son malas casi
    # siempre (lejos, en diagonal, con la patente chica). Descartar lectura por
    # lectura tiraría el auto antes de llegar a la mirada buena; descartar el
    # grupo entero pregunta lo correcto: "de todo lo que vimos de este auto,
    # ¿algo sirvió?".
    confidence = float(result.get("confidence") or 0)
    if confidence < DISCARD_BELOW:
        logger.debug(
            "cluster_below_floor",
            extra={"confidence": confidence, "floor": DISCARD_BELOW},
        )
        return None

    now = time.monotonic()

    # ── Un auto que ya conocemos no genera otra imagen ────────────────────────
    #
    # Antes esto sólo miraba un cooldown por tiempo, y el resto lo tapaba el
    # renderer DESPUÉS de que acá ya se hubiera escrito el JPEG y creado el
    # evento. Por eso un auto quieto en la entrada dejaba una imagen cada 6-10
    # segundos: quedaban marcadas `suppressed_pending_event`, pero el gasto de
    # disco y de subida ya estaba hecho.
    #
    # LA AUTORIDAD ES EL RENDERER, NO LA BASE DE ESTE SERVICIO
    #
    # La primera versión de esto preguntaba a la base local "¿hay un evento
    # `pending` con esta patente?". Parecía lo natural y estuvo MAL: las dos
    # bases derivan. Cuando el operador descarta una tarjeta, el renderer avisa
    # con un PATCH best-effort, y si el servicio está reiniciándose ese aviso se
    # pierde y no lo reintenta nadie. La fila se queda `pending` para siempre.
    #
    # Con la base como autoridad, una fila así deja esa patente CIEGA para
    # siempre. Pasó: un `AB123CD` de hacía un mes bloqueaba todas las
    # detecciones nuevas de ese auto, y el servicio se veía perfectamente sano.
    # Había 69 filas zombi de ese tipo.
    #
    # Ahora la lista la manda el renderer, que no puede derivar porque es el
    # mismo que le muestra las tarjetas al operador, y encima VENCE: si el
    # renderer se cae, la lista se vacía sola y se vuelve a guardar de más, que
    # es el error seguro.
    #
    # La comparación es por texto EXACTO, no por parecido: el renderer también
    # suprime por texto exacto, así que esto no cambia nada de lo que ve el
    # operador, sólo evita el gasto. Por parecido, un auto distinto con patente
    # similar a una tarjeta abierta desaparecería sin que nadie se entere.
    testing = _testing_mode()

    if normalized and not testing and is_ignored(normalized, _ignored_plate_snapshot):
        return None

    if normalized and not testing and normalized in _known_plates():
        print(
            f"[{_ts()}]  DUPLICATE {normalized:<12}  reason=known-by-operator",
            flush=True,
        )
        return None

    if normalized and not testing:
        last_saved = _last_saved_by_plate.get(normalized, 0)
        remaining = COOLDOWN - (now - last_saved)
        if remaining > 0:
            print(
                f"[{_ts()}]  DUPLICATE {normalized:<12}  "
            f"reason=cooldown remaining={remaining:.0f}s",
                flush=True,
            )
            return None

    event_id = str(uuid.uuid4())
    try:
        capture_id = _storage.save(
            best["frame"],
            CAMERA_ID,
            CAMERA_LOCATION,
            lpr_result={
                "plate": _display_plate(result),
                "confidence": float(result.get("confidence") or 0),
            },
            event_id=event_id,
            bbox=bbox,
        )
    except IOError as exc:
        logger.error("capture_save_failed", extra={"error": str(exc)})
        return None

    event = _storage.upsert_lpr_event(
        {
            "id": event_id,
            "camera_id": CAMERA_ID,
            "location": CAMERA_LOCATION,
            "first_seen_at": _iso_from_monotonic(cluster["first_seen"]),
            "last_seen_at": _iso_from_monotonic(cluster["last_seen"]),
            "raw_text": result.get("rawText"),
            "normalized_text": normalized or None,
            "display_plate": _display_plate(result) or None,
            "confidence": float(result.get("confidence") or 0),
            "format_valid": bool(result.get("formatValid")),
            "format_type": result.get("formatType") or "unknown",
            "quality_status": result.get("qualityStatus") or "low_confidence",
            "status": "pending",
            "entry_id": None,
            "reviewed_at": None,
            "image_storage_path": None,
            "image_url": None,
            "best_capture_id": capture_id,
            "candidates": [_candidate_snapshot(c) for c in cluster["candidates"]],
            "plate_bbox": _normalized_bbox(bbox, best["frame"].shape),
        }
    )

    if normalized:
        _last_saved_by_plate[normalized] = now
    _last_detection = event
    return event


def _flush_settled_clusters(now: float) -> list[dict]:
    flushed: list[dict] = []
    remaining: list[dict] = []
    for cluster in _clusters:
        settled = (now - cluster["last_seen"]) >= CLUSTER_SETTLE
        expired = (now - cluster["first_seen"]) >= CLUSTER_WINDOW
        if settled or expired:
            event = _persist_cluster(cluster)
            if event is not None:
                _detection_events.publish(event)
                flushed.append(event)
        else:
            remaining.append(cluster)
    _clusters[:] = remaining
    return flushed


async def _purge_loop() -> None:
    """Borrar capturas viejas ya respaldadas, una vez por día.

    Va en su propia tarea y no en el loop de detección: ese corre a 10 Hz y no
    tiene por qué cargar con una pasada de I/O sobre el disco.

    La primera corrida se demora un minuto para no competir con el arranque,
    que es cuando el equipo está abriendo la cámara y levantando el modelo.
    """
    await asyncio.sleep(60)
    while not _shutting_down:
        try:
            if _storage is not None:
                await asyncio.to_thread(
                    _storage.purge_images_older_than, IMAGE_RETENTION_DAYS
                )
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("purge_failed")
        await asyncio.sleep(24 * 60 * 60)


_STATUS_PRINT_EVERY = 5.0
_last_status_print: tuple[str, float] = ("", 0.0)


def _throttled_status(message: str) -> None:
    """Imprime un estado repetitivo como mucho cada `_STATUS_PRINT_EVERY` segundos.

    Estos mensajes salían en cada vuelta del loop, o sea diez veces por segundo
    mientras la cámara estuviera caída — y puede estarlo horas. Cada `print`
    con `flush=True` es una escritura a un pipe que lee Electron MÁS una línea
    en el archivo de log, así que el disco y el CPU se iban en repetir la misma
    frase. El mensaje sigue apareciendo y sigue actualizando la hora: lo único
    que cambia es que no se repite cien veces por minuto.
    """
    global _last_status_print
    last_message, last_at = _last_status_print
    now = time.monotonic()
    if message == last_message and (now - last_at) < _STATUS_PRINT_EVERY:
        return
    _last_status_print = (message, now)
    print(f"\r[{_ts()}]  {message:<46}", end="", flush=True)


async def _process_loop() -> None:
    """Motion-triggered LPR pipeline.

    Every 100 ms the loop reads the latest camera frame and asks the motion
    detector whether something changed significantly. When it does, the
    snapshot captured at that instant is sent to the LPR service. A periodic
    fallback scan runs every FALLBACK_INTERVAL seconds so that a vehicle
    already present when the service starts is not missed.

    Filtering pipeline per triggered snapshot:
      1. Motion gate  — skip if below threshold or within motion cooldown.
      2. LPR call     — skip if no plate detected or service unreachable.
      3. Cluster      — merge similar plate/bbox detections in a short window.
      4. Persist      — write the best candidate image + event row to SQLite.
    """
    loop = asyncio.get_event_loop()
    lpr_calls = 0
    saved = 0
    lpr_busy = False
    last_fallback = time.monotonic()
    camera_was_down = False

    while not _shutting_down:
        # El pipeline entero va adentro del try: una excepción acá mataba la
        # tarea de asyncio y con ella TODA la detección de patentes, sin que
        # se notara —el video seguía sirviéndose y los endpoints respondiendo—.
        # Perder un frame y seguir es siempre mejor que quedarse ciego.
        try:
            await asyncio.sleep(0.1)  # ~10 Hz — matches capture FPS
            flushed = _flush_settled_clusters(time.monotonic())
            if flushed:
                saved += len(flushed)
                for event in flushed:
                    plate = event.get("displayPlate") or event.get("text") or ""
                    conf = float(event.get("confidence") or 0)
                    status = event.get("status")
                    print(
                        f"\r[{_ts()}]  DETECTED  {plate:<12}  [{_conf_bar(conf)}] {conf:.0%}  status={status} saved={saved}",
                        flush=True,
                    )

            # Skip LPR while the camera is down to avoid running inference on a
            # stale frame. When the camera recovers, reset the motion detector so
            # the first new frame starts a fresh warmup instead of diffing against
            # the pre-outage reference.
            camera_down = _watchdog is not None and _watchdog.status()["camera"] == "down"
            if camera_down:
                camera_was_down = True
                _throttled_status("camera down — pausing LPR...")
                continue
            if camera_was_down:
                _motion.reset()
                camera_was_down = False

            frame = _capture.latest_frame()
            if frame is None:
                _throttled_status("waiting for camera...")
                continue

            triggered, snapshot = _motion.check(frame)

            # Fallback: if no motion-triggered scan for FALLBACK_INTERVAL seconds,
            # force one scan to catch vehicles that were already in view at startup
            # or during a detection gap.
            now = time.monotonic()
            if not triggered and (now - last_fallback) >= FALLBACK_INTERVAL:
                triggered = True
                snapshot = frame.copy()
                logger.info("lpr_fallback_scan")

            if _shutting_down or not triggered or lpr_busy:
                continue

            # EL ROI SE APLICA ACÁ, NO SOLO AL MOVIMIENTO.
            #
            # El detector es `yolo-v9-t-384`: reescala a 384x384 lo que sea que
            # reciba. Mandarle el cuadro completo de una cámara de 2560x1440
            # significa achicar 6,7 veces, y una patente de 320 px llega al
            # modelo con 48 px: no la ve. Medido sobre un frame real de la
            # Hikvision, con la patente nítida y centrada:
            #
            #     frame completo 2560x1440  -> SIN DETECCION
            #     reescalado a 1280x720     -> SIN DETECCION   (no es el tamaño
            #     reescalado a 640x360      -> SIN DETECCION    del JPEG, es la
            #     recorte al ROI 1131x762   -> 'GIL 322' 0.945  proporción)
            #
            # Reescalar antes no arregla nada, porque lo que decide es qué
            # FRACCIÓN del cuadro ocupa la patente, y eso no cambia al achicar.
            # Lo único que la agranda es recortar.
            #
            # Así se veía el síntoma: no fallaba del todo, "tardaba". Detectaba
            # sólo cuando el auto ya estaba encima y la patente era enorme, y
            # mientras tanto el log mostraba scans saliendo con 404 (que en el
            # LPR es "no hay patente", no un error).
            #
            # El recorte reemplaza al snapshot y no se queda sólo para la
            # inferencia, a propósito: el `bbox` que vuelve del LPR está en
            # coordenadas de la imagen que se mandó, y esa misma imagen es la
            # que se guarda como evidencia y sobre la que `_crop_to_plate`
            # dibuja el recuadro. Si se mandara el recorte y se guardara el
            # cuadro completo, el recuadro quedaría corrido.
            #
            # Sin ROI configurado esto no hace nada (`roi_crop` devuelve el
            # frame tal cual), que es el comportamiento de siempre.
            snapshot = roi_crop(snapshot, ROI)

            # Y si no hay ROI y la cámara es de alta resolución, avisar UNA vez:
            # es exactamente la instalación donde esto falla en silencio, porque
            # el servicio se ve perfecto —video fluido, scans saliendo— y lo
            # único que pasa es que casi nunca detecta.
            if ROI is None and snapshot.shape[1] >= 1600 and not _warned_no_roi:
                globals()["_warned_no_roi"] = True
                logger.warning(
                    "sin zona de detección con una cámara de %dx%d: la patente le "
                    "llega al modelo demasiado chica y se van a perder detecciones. "
                    "Marcá la zona en Configurar cámara.",
                    snapshot.shape[1], snapshot.shape[0],
                )

            # Reset fallback clock on every actual LPR call (motion or fallback).
            last_fallback = time.monotonic()
            lpr_calls += 1

            # LPR is a blocking HTTP call; run in a single-worker executor so at
            # most one inference is in flight at a time. Subsequent motion triggers
            # while lpr_busy are silently dropped — the vehicle is still there and
            # the next motion event will catch it.
            lpr_busy = True
            try:
                result = await loop.run_in_executor(_lpr_executor, lpr_client.recognize, snapshot)
            finally:
                lpr_busy = False

            if result is None:
                logger.debug("lpr_no_plate", extra={"calls": lpr_calls})
                continue

            plate = _display_plate(result)
            conf  = result["confidence"]

            if conf < MIN_CONFIDENCE and result.get("qualityStatus") != "invalid_format":
                result["qualityStatus"] = "low_confidence"

            if conf < MIN_CONFIDENCE:
                print(
                    f"\r[{_ts()}]  low conf  {plate:<12}  [{_conf_bar(conf)}] {conf:.0%}  (queued)",
                    flush=True,
                )

            _add_cluster_candidate(result, snapshot, time.monotonic())
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("process_loop_tick_failed")
            await asyncio.sleep(0.5)


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _capture, _storage, _watchdog, _motion, _lpr_executor, _shutting_down, _ignored_plate_snapshot

    # Single-worker executor: at most one ONNX inference at a time.
    # On a low-end parking-lot PC this prevents CPU saturation when multiple
    # motion events arrive faster than inference completes.
    _lpr_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="lpr")

    _capture  = CameraCapture(CAMERA_SOURCE, CAMERA_FPS, CAMERA_WIDTH, CAMERA_HEIGHT)
    _storage  = LocalStorage(DB_PATH, IMAGES_DIR, CAMERA_TENANT_ID)
    stored_rules = _storage.load_rule_snapshot()
    if stored_rules:
        try:
            _ignored_plate_snapshot = parse_snapshot(stored_rules.get("tenantId"), stored_rules.get("ignoredPlates"))
        except ValueError:
            logger.warning("invalid_stored_lpr_rules")
    _watchdog = CameraWatchdog(_capture, WATCHDOG_TIMEOUT)
    _motion   = MotionDetector(MOTION_THRESHOLD, MOTION_COOLDOWN, ROI)

    # ANTES de snapshotear los defaults: si no, `/config/reset` restauraría una
    # combinación incoherente, y un CAMERA_CLUSTER_SETTLE por variable de
    # entorno dejaría el bug intacto.
    g = globals()
    g["CLUSTER_SETTLE"], g["CLUSTER_WINDOW"] = _coherent_cluster_timing(
        MOTION_COOLDOWN, CLUSTER_SETTLE, CLUSTER_WINDOW
    )

    _snapshot_defaults()
    _capture.start()
    _watchdog.start()
    task = asyncio.create_task(_process_loop())
    purge_task = asyncio.create_task(_purge_loop())

    _print_banner()
    logger.info(
        "camera_service_started — source=%s location=%s tenant=%s",
        redact_source(CAMERA_SOURCE), CAMERA_LOCATION, CAMERA_TENANT_ID,
    )
    yield

    _shutting_down = True
    task.cancel()
    purge_task.cancel()
    with suppress(asyncio.CancelledError, asyncio.TimeoutError):
        await asyncio.wait_for(task, timeout=PROCESS_LOOP_SHUTDOWN_TIMEOUT)
    with suppress(asyncio.CancelledError, asyncio.TimeoutError):
        await asyncio.wait_for(purge_task, timeout=PROCESS_LOOP_SHUTDOWN_TIMEOUT)
    _watchdog.stop()
    _capture.stop()
    _lpr_executor.shutdown(wait=True, cancel_futures=True)
    _storage.close()


# ── App ───────────────────────────────────────────────────────────────────────

app = FastAPI(title="Camera Service", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    # PATCH y DELETE ya se usaban (`/detections/{id}`, `/detection/latest`) pero
    # no estaban declarados acá: funcionaba de casualidad porque el renderer no
    # dispara preflight para requests simples.
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {"status": "ok", "version": BUILD_VERSION}


@app.post("/shutdown", status_code=202)
def shutdown(x_parkit_shutdown_token: str | None = Header(default=None)):
    """Trigger uvicorn's own graceful-shutdown path from inside the process.

    Electron calls this instead of relying on OS signals: on Windows, Node's
    ChildProcess.kill() ignores the signal argument and always force-kills
    (TerminateProcess), which would skip the `lifespan` cleanup above
    entirely. Flipping `should_exit` drives the same shutdown path uvicorn
    uses for SIGTERM/SIGINT, and works identically on every platform.
    """
    global _shutting_down
    _require_shutdown_token(x_parkit_shutdown_token)
    _shutting_down = True
    if _server is not None:
        _server.should_exit = True
    return {"status": "shutting down"}


@app.get("/stream/status")
def stream_status():
    # `source` va SIEMPRE redactada: este endpoint lo consume el renderer y sin
    # eso la contraseña de la cámara terminaría en el DevTools de cualquiera.
    source = redact_source(_capture.source) if _capture is not None else None
    if _watchdog is None:
        return {
            "camera": "initializing",
            "down_since": None,
            "reconnect_attempts": 0,
            "source": source,
        }
    return {**_watchdog.status(), "source": source}


def _downscale_for_stream(frame, max_width: int):
    """Achica el cuadro al ancho del preview antes de codificarlo a JPEG.

    Codificar 2560×1440 diez veces por segundo cuesta ~15-28 ms por cuadro; a
    960 px de ancho cuesta unas siete veces menos. En un panel de escritorio la
    diferencia no se ve, y este costo sólo existe mientras alguien tiene la
    pestaña Cámara abierta.

    No afecta ni a la detección ni a la imagen que se guarda como evidencia:
    las dos salen del cuadro original. Esto es sólo lo que se dibuja en
    pantalla.
    """
    if max_width <= 0:
        return frame

    height, width = frame.shape[:2]
    if width <= max_width:
        return frame

    scale = max_width / width
    return cv2.resize(
        frame,
        (max_width, max(1, int(round(height * scale)))),
        interpolation=cv2.INTER_AREA,
    )


def _mjpeg_frames(max_width: int):
    """Yield the latest camera frame as an endless multipart JPEG stream.

    Consumed directly by an <img> tag in the renderer (browsers render
    multipart/x-mixed-replace natively). Runs in Starlette's threadpool, so the
    blocking time.sleep here never stalls the asyncio event loop. When the
    client (the Cámara tab) disconnects, Starlette raises GeneratorExit and the
    loop ends, freeing the worker.
    """
    boundary = b"--frame\r\n"
    interval = 1.0 / STREAM_FPS
    while True:
        frame = _capture.latest_frame() if _capture is not None else None
        if frame is None:
            time.sleep(0.1)  # camera not ready yet — wait without busy-looping
            continue
        ok, buf = cv2.imencode(
            ".jpg", _downscale_for_stream(frame, max_width), _STREAM_JPEG
        )
        if not ok:
            time.sleep(interval)
            continue
        yield boundary + b"Content-Type: image/jpeg\r\n\r\n" + buf.tobytes() + b"\r\n"
        time.sleep(interval)


@app.get("/stream/mjpeg")
def stream_mjpeg(maxWidth: int | None = None):  # noqa: N803 (query param)
    """Live MJPEG preview for the desktop UI.

    `maxWidth` pisa `CAMERA_STREAM_MAX_WIDTH` para esta conexión; `0` manda el
    cuadro SIN achicar.

    POR QUÉ HACE FALTA EL OVERRIDE, Y ES IMPORTANTE

    El editor de ROI convierte lo que el usuario arrastra a píxeles usando el
    `naturalWidth` del `<img>`, o sea **el tamaño del cuadro que le llega por
    este endpoint** (`RoiEditor.tsx`). El servicio después aplica ese ROI sobre
    el cuadro ORIGINAL a resolución completa.

    O sea que las dos resoluciones tienen que ser la misma o el ROI queda mal:
    achicar el preview a 960 y seguir aplicando el recorte sobre 2560 hace que
    la zona marcada cubra apenas un tercio de lo que el usuario dibujó, y que
    un ROI ya guardado se dibuje fuera de pantalla. Pasó: lo introdujo el
    cambio que achicó el preview para ahorrar CPU.

    Por eso el editor pide `maxWidth=0` y el preview normal no. Si algún día el
    ROI pasa a guardarse en coordenadas relativas (0-1), esto deja de hacer
    falta.

    Devuelve 503 cuando no hay nada que mostrar, en vez de abrir un stream que
    se queda esperando frames para siempre. Sin esto, con la cámara caída el
    <img> del panel nunca dispara `onError` y el operador ve un recuadro en
    blanco hasta que el poll de estado lo note —hasta 10 segundos—. Con una
    cámara de red, que se cae mucho más seguido que un cable USB, esa demora es
    la diferencia entre "está desconectada" y "esta app no anda".
    """
    if _capture is None or _capture.latest_frame() is None:
        raise HTTPException(status_code=503, detail="camera has no frames yet")
    width = STREAM_MAX_WIDTH if maxWidth is None else max(0, maxWidth)
    return StreamingResponse(
        _mjpeg_frames(width),
        media_type="multipart/x-mixed-replace; boundary=frame",
    )


@app.post("/probe")
def probe_source(payload: dict):
    """Probar una fuente de video SIN tocar la captura en curso.

    Es lo que hace útil al botón "Probar conexión" del panel: hoy la única forma
    de saber si una URL anda es guardarla, reiniciar y mirar si aparece imagen.
    Abre un VideoCapture aparte, lee un frame y lo cierra.

    Corre en el threadpool de Starlette (la función es `def`, no `async def`),
    así que el bloqueo de la apertura no frena el loop de asyncio ni el pipeline
    de detección.
    """
    source = payload.get("source")
    if not isinstance(source, str) or not source.strip():
        raise HTTPException(status_code=400, detail="source is required")

    probe = CameraCapture(source.strip(), CAMERA_FPS, CAMERA_WIDTH, CAMERA_HEIGHT)
    return probe.probe()


# ── Ajustes en caliente ───────────────────────────────────────────────────────
#
# Cada instalación es distinta —el ángulo del portón, cuánta calle entra en
# cuadro, qué tan transitada es— así que estos valores se calibran en el lugar,
# mirando el video, y no se pueden fijar de antemano en el código.
#
# nombre -> (tipo, mínimo, máximo)
_TUNABLES: dict[str, tuple[type, float, float]] = {
    # Detección
    "motionThreshold": (float, 0.1, 50.0),
    "motionCooldown": (float, 0.1, 60.0),
    "minConfidence": (float, 0.0, 1.0),
    "discardBelow": (float, 0.0, 1.0),
    "plateCooldown": (float, 0.0, 300.0),
    "fallbackInterval": (float, 10.0, 3600.0),
    # Agrupamiento de lecturas de un mismo auto.
    # Los topes de clusterWindow/clusterSettle son holgados a propósito: el
    # piso que les calcula `_coherent_cluster_timing` crece con motionCooldown
    # (hasta 60 s), y si el tope fuera más bajo el panel terminaría mostrando
    # un valor fuera de su propio rango.
    "clusterWindow": (float, 0.5, 150.0),
    "clusterSettle": (float, 0.1, 70.0),
    "moveMaxRatio": (float, 0.01, 1.0),
    "plateMergeDistance": (int, 0, 4),
    # Captura (width/height/fps solo aplican a webcam: una cámara IP manda lo suyo)
    "fps": (int, 1, 60),
    "width": (int, 160, 7680),
    "height": (int, 120, 4320),
    "watchdogTimeout": (int, 1, 120),
    # Preview
    "streamFps": (int, 1, 30),
    "streamQuality": (int, 10, 100),
    # 0 = mandar el cuadro sin achicar.
    "streamMaxWidth": (int, 0, 7680),
}

_GLOBAL_BY_KEY = {
    "motionThreshold": "MOTION_THRESHOLD",
    "motionCooldown": "MOTION_COOLDOWN",
    "minConfidence": "MIN_CONFIDENCE",
    "discardBelow": "DISCARD_BELOW",
    "plateCooldown": "COOLDOWN",
    "fallbackInterval": "FALLBACK_INTERVAL",
    "clusterWindow": "CLUSTER_WINDOW",
    "clusterSettle": "CLUSTER_SETTLE",
    # `bboxCloseRatio` se RENOMBRÓ, no se reinterpretó. Cambió de escala (lado
    # de la patente -> diagonal del cuadro) y de default (0,35 -> 0,15). Como
    # la calibración se persiste en el backend y se reinyecta al arrancar,
    # reusar la clave le habría dejado a una instalación vieja un umbral de
    # 0,35 DE LA DIAGONAL, que acepta casi cualquier cosa. Los valores viejos
    # que sigan en el JSON guardado se ignoran solos: esto itera sobre las
    # claves conocidas, no sobre el payload.
    "moveMaxRatio": "MOVE_MAX_RATIO",
    "plateMergeDistance": "PLATE_MERGE_DISTANCE",
    "fps": "CAMERA_FPS",
    "width": "CAMERA_WIDTH",
    "height": "CAMERA_HEIGHT",
    "watchdogTimeout": "WATCHDOG_TIMEOUT",
    "streamFps": "STREAM_FPS",
    "streamQuality": "STREAM_QUALITY",
    "streamMaxWidth": "STREAM_MAX_WIDTH",
}


# Los valores con los que arrancó el proceso, capturados ANTES de que el panel
# pueda tocar nada. Son el destino del botón "Restablecer": sin esta foto, la
# primera edición pisa los globales y ya no hay a dónde volver.
_DEFAULT_TUNING: dict = {}
_DEFAULT_ROI = ROI


def _snapshot_defaults() -> None:
    g = globals()
    for key, name in _GLOBAL_BY_KEY.items():
        _DEFAULT_TUNING[key] = g[name]


def _current_config() -> dict:
    g = globals()
    values = {key: g[name] for key, name in _GLOBAL_BY_KEY.items()}
    values["roi"] = list(ROI) if ROI else None
    values["cameraId"] = CAMERA_ID
    values["location"] = CAMERA_LOCATION
    values["source"] = redact_source(_capture.source) if _capture else None
    return values


@app.get("/config")
def get_config():
    """Todos los ajustes vigentes. `source` va redactada."""
    return _current_config()


@app.post("/config")
def set_config(payload: dict):
    """Aplicar ajustes sin reiniciar el proceso.

    Valida contra `_TUNABLES` y RECHAZA el lote entero si algo está fuera de
    rango, en vez de aplicar la mitad: una configuración a medio aplicar es
    imposible de diagnosticar después mirando el panel.
    """
    g = globals()
    updates: dict[str, float | int] = {}

    for key, (kind, low, high) in _TUNABLES.items():
        if key not in payload or payload[key] is None:
            continue
        try:
            value = kind(payload[key])
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail=f"{key}: no es un número")
        if not (low <= value <= high):
            raise HTTPException(
                status_code=400, detail=f"{key}: fuera de rango [{low}, {high}]"
            )
        updates[key] = value

    roi_given = "roi" in payload
    roi = None
    if roi_given and payload["roi"] is not None:
        raw = payload["roi"]
        if not isinstance(raw, (list, tuple)) or len(raw) != 4:
            raise HTTPException(status_code=400, detail="roi: se esperaban 4 números")
        try:
            x1, y1, x2, y2 = (int(v) for v in raw)
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="roi: valores no enteros")
        if x1 >= x2 or y1 >= y2 or min(x1, y1) < 0:
            raise HTTPException(status_code=400, detail="roi: rectángulo inválido")
        roi = (x1, y1, x2, y2)

    # Recién acá se escribe: si algo falló arriba, no se tocó nada.
    for key, value in updates.items():
        g[_GLOBAL_BY_KEY[key]] = value
    if roi_given:
        g["ROI"] = roi
        g["_warned_no_roi"] = False

    # STREAM_FPS nunca puede superar el FPS de captura: pedir más cuadros de los
    # que entran solo hace que el generador duerma de más.
    g["STREAM_FPS"] = max(1, min(CAMERA_FPS, STREAM_FPS))
    g["_STREAM_JPEG"] = [cv2.IMWRITE_JPEG_QUALITY, STREAM_QUALITY]

    # El settle y la ventana tienen que ser coherentes con la cadencia real de
    # análisis, o agrupar es imposible. Mismo criterio que el clamp de
    # STREAM_FPS de acá arriba. Ver `_coherent_cluster_timing`.
    g["CLUSTER_SETTLE"], g["CLUSTER_WINDOW"] = _coherent_cluster_timing(
        MOTION_COOLDOWN, CLUSTER_SETTLE, CLUSTER_WINDOW
    )

    if _motion is not None:
        _motion.configure(
            threshold=MOTION_THRESHOLD,
            cooldown=MOTION_COOLDOWN,
            roi=ROI,
            roi_given=roi_given,
        )
    if _watchdog is not None:
        _watchdog.set_timeout(WATCHDOG_TIMEOUT)

    logger.info("camera_config_updated", extra={"keys": sorted(updates) + (["roi"] if roi_given else [])})
    return _current_config()


@app.post("/config/source")
def config_source(payload: dict):
    """Apuntar a otra cámara sin reiniciar el proceso.

    `camera_id` y `location` viajan juntos porque son metadata de la MISMA
    cámara: si cambia la fuente y no cambian ellos, las detecciones nuevas
    quedan atribuidas a la cámara anterior.
    """
    if _capture is None:
        raise HTTPException(status_code=503, detail="capture not started")

    source = payload.get("source")
    if not isinstance(source, str) or not source.strip():
        raise HTTPException(status_code=400, detail="source is required")

    global CAMERA_ID, CAMERA_LOCATION
    camera_id = payload.get("cameraId")
    if isinstance(camera_id, str) and camera_id.strip():
        CAMERA_ID = camera_id.strip()
    location = payload.get("location")
    if isinstance(location, str) and location.strip():
        CAMERA_LOCATION = location.strip()

    _capture.set_source(source.strip())
    if _watchdog is not None:
        _watchdog.note_source_change()
    if _motion is not None:
        # La referencia de movimiento es de la cámara anterior: compararla con
        # la nueva no tiene sentido, y si además cambia la resolución, revienta.
        _motion.reset()
    logger.info("camera_source_changed", extra={"source": redact_source(source)})
    return {
        "source": redact_source(_capture.source),
        "cameraId": CAMERA_ID,
        "location": CAMERA_LOCATION,
    }


@app.post("/config/reset")
def reset_config():
    """Volver a los valores con los que arrancó el servicio.

    No toca la fuente de video: restablecer la calibración no debería
    desconectarle la cámara a nadie.
    """
    g = globals()
    for key, value in _DEFAULT_TUNING.items():
        g[_GLOBAL_BY_KEY[key]] = value
    g["ROI"] = _DEFAULT_ROI
    g["_STREAM_JPEG"] = [cv2.IMWRITE_JPEG_QUALITY, STREAM_QUALITY]

    # El settle y la ventana tienen que ser coherentes con la cadencia real de
    # análisis, o agrupar es imposible. Mismo criterio que el clamp de
    # STREAM_FPS de acá arriba. Ver `_coherent_cluster_timing`.
    g["CLUSTER_SETTLE"], g["CLUSTER_WINDOW"] = _coherent_cluster_timing(
        MOTION_COOLDOWN, CLUSTER_SETTLE, CLUSTER_WINDOW
    )

    if _motion is not None:
        _motion.configure(
            threshold=MOTION_THRESHOLD,
            cooldown=MOTION_COOLDOWN,
            roi=ROI,
            roi_given=True,
        )
    if _watchdog is not None:
        _watchdog.set_timeout(WATCHDOG_TIMEOUT)

    logger.info("camera_config_reset")
    return _current_config()


@app.get("/detections")
def detections_list(limit: int = 20):
    """Return the last `limit` detections from local storage (max 100)."""
    if _storage is None:
        return []
    return _storage.list_recent(min(limit, 100))


@app.get("/detection/latest")
def detection_latest():
    """Return the last plate detected in memory, or 404 if none since service started."""
    if _last_detection is None:
        raise HTTPException(status_code=404, detail="No plate detected yet")
    return _last_detection


@app.post("/known-plates")
def set_known_plates(payload: dict):
    """Las patentes que ya están adentro, según el renderer.

    El servicio no puede averiguarlo solo —las estadías viven en Dexie— y sin
    este dato un auto estacionado frente a la cámara genera una imagen por
    ciclo aunque ya esté registrado.

    Se normaliza acá además de del otro lado para que la comparación sea
    exactamente la misma que la de `_persist_cluster`. La regla tiene que
    coincidir con `normalisePlate` del renderer (`useCameraDetections.ts`):
    fuera espacios, guiones y guiones bajos, y todo a mayúsculas. Si las dos
    divergen, la supresión no matchea nunca y el síntoma es silencioso —sigue
    guardando de más— así que conviene que estén escritas igual.
    """
    if "ignoredPlates" in payload:
        try:
            snapshot = parse_snapshot(payload.get("tenantId"), payload["ignoredPlates"])
        except ValueError as error:
            raise HTTPException(status_code=400, detail=str(error)) from error
    else:
        snapshot = None
    raw = payload.get("plates")
    if not isinstance(raw, list):
        raise HTTPException(status_code=400, detail="plates: se esperaba una lista")
    plates = {
        normalized
        for normalized in (
            re.sub(r"[\s_-]", "", p).upper()
            for p in raw
            if isinstance(p, str)
        )
        if normalized
    }
    testing = payload.get("testingMode") is True
    g = globals()
    if snapshot is not None:
        if snapshot != _ignored_plate_snapshot and _storage is not None:
            _storage.save_rule_snapshot(snapshot)
        g["_ignored_plate_snapshot"] = snapshot
    if testing != _testing_mode():
        logger.warning("testing_mode_on" if testing else "testing_mode_off")
    g["_known_plates_value"] = plates
    g["_known_plates_at"] = time.monotonic()
    g["_testing_mode_at"] = time.monotonic() if testing else None
    return {"count": len(plates), "testingMode": testing}


@app.post("/detections/{event_id}/uploaded")
def detections_mark_uploaded(event_id: str, body: dict):
    """El renderer avisa que ya subió la imagen de este evento a la nube.

    Es lo único que habilita a la purga local a borrar ese archivo: este
    servicio no habla con el backend, así que por su cuenta no puede saber qué
    está respaldado y qué no.
    """
    if _storage is None:
        raise HTTPException(status_code=503, detail="Storage not ready")
    storage_path = body.get("storagePath")
    if not isinstance(storage_path, str) or not storage_path:
        raise HTTPException(status_code=400, detail="storagePath: falta o es inválido")
    if not _storage.mark_lpr_event_uploaded(event_id, storage_path):
        raise HTTPException(status_code=404, detail="Detection event not found")
    return {"ok": True}


@app.get("/detections/pending")
def detections_pending():
    """Plates detected but not yet registered/dismissed by the operator."""
    if _storage is None:
        return []
    return _storage.list_pending_lpr_events()


@app.get("/detections/events")
async def detections_events(request: Request):
    """Server-Sent Events for new local LPR detections."""

    async def stream():
        queue = _detection_events.subscribe()
        try:
            yield _sse_message("ping", {"ts": datetime.now(timezone.utc).isoformat()})
            while not await request.is_disconnected():
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=15.0)
                except asyncio.TimeoutError:
                    yield _sse_message(
                        "ping", {"ts": datetime.now(timezone.utc).isoformat()}
                    )
                    continue
                yield _sse_message("detection", event)
        finally:
            _detection_events.unsubscribe(queue)

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.patch("/detections/{event_id}")
def detections_update(event_id: str, body: dict):
    """Update an LPR event status after operator action or local suppression."""
    if _storage is None:
        raise HTTPException(status_code=503, detail="Storage not ready")
    status = body.get("status")
    if status not in {
        "registered",
        "dismissed",
        "suppressed_active_entry",
        "suppressed_pending_event",
        "suppressed_recent_exit",
    }:
        raise HTTPException(status_code=422, detail="Invalid detection status")
    event = _storage.update_lpr_event_status(
        event_id,
        status,
        entry_id=body.get("entryId") or body.get("entry_id"),
    )
    if event is None:
        raise HTTPException(status_code=404, detail="Detection event not found")
    return event


@app.delete("/detections/pending/{plate}", status_code=204)
def detections_pending_clear(plate: str):
    """Backwards-compatible dismiss for older renderer builds."""
    if _storage is None:
        return
    event = _storage.get_lpr_event(plate)
    if event is not None:
        _storage.update_lpr_event_status(plate, "dismissed")


def _normalized_bbox(
    bbox: tuple[int, int, int, int] | None, frame_shape
) -> dict | None:
    """El recuadro de la patente en fracciones de la imagen, no en píxeles.

    Es lo que viaja a la nube, y tiene que ser relativo a LA IMAGEN GUARDADA
    porque esa imagen se reescala antes de subirse: un bbox en píxeles no
    correspondería a ningún píxel del archivo que termina en el bucket, y
    obligaría a guardar también sus dimensiones.

    De paso sobrevive a que el instalador recalibre el ROI: es relativo a la
    imagen de ESTE evento, no a la zona de detección vigente.

    Devuelve None si la caja es degenerada. Ese None viaja tal cual y del otro
    lado significa "no recortes", que es el comportamiento seguro.
    """
    if bbox is None or frame_shape is None:
        return None
    h, w = frame_shape[0], frame_shape[1]
    if w <= 0 or h <= 0:
        return None
    x1, y1, x2, y2 = bbox
    x = min(max(x1 / w, 0.0), 1.0)
    y = min(max(y1 / h, 0.0), 1.0)
    bw = min(max((x2 - x1) / w, 0.0), 1.0 - x)
    bh = min(max((y2 - y1) / h, 0.0), 1.0 - y)
    if bw <= 0 or bh <= 0:
        return None
    # 6 decimales: sobre 2560 px eso es 0,0026 px, muy por debajo del error del
    # detector, y evita que el JSON se llene de ruido de punto flotante.
    return {
        "x": round(x, 6),
        "y": round(y, 6),
        "w": round(bw, 6),
        "h": round(bh, 6),
    }


# Cuánto contexto se deja alrededor de la patente al recortar.
#
# ESTE PAR DE NÚMEROS ESTÁ ESCRITO DOS VECES
#
# Acá, y en `front-web/src/features/owner/sections/auditoria/lprImage.ts`, que
# recorta por CSS a partir del bbox normalizado. Si divergen, el operador y el
# dueño ven encuadres distintos del MISMO evento y no hay forma de darse
# cuenta mirando una sola pantalla. Si tocás uno, tocá el otro.
PLATE_CROP_PAD_X = 0.4
PLATE_CROP_PAD_Y = 0.6


def _crop_to_plate(image, bbox_str: str | None):
    """Crop around the plate bbox (with padding) and draw a frame on it.

    Returns the full image unchanged when no usable bbox is available.
    """
    if not bbox_str:
        return image
    try:
        x1, y1, x2, y2 = (int(v) for v in bbox_str.split(","))
    except ValueError:
        return image
    h, w = image.shape[:2]
    pad_x = int((x2 - x1) * PLATE_CROP_PAD_X)
    pad_y = int((y2 - y1) * PLATE_CROP_PAD_Y)
    cx1, cy1 = max(0, x1 - pad_x), max(0, y1 - pad_y)
    cx2, cy2 = min(w, x2 + pad_x), min(h, y2 + pad_y)
    crop = image[cy1:cy2, cx1:cx2].copy()
    cv2.rectangle(crop, (x1 - cx1, y1 - cy1), (x2 - cx1, y2 - cy1), (0, 200, 0), 2)
    return crop


@app.get("/capture/{capture_id}/image.jpg")
def capture_full_image(capture_id: str, maxWidth: int | None = None, quality: int | None = None):
    """La foto completa del área vigilada, sin recortar y sin recuadro dibujado.

    Es lo que deja ver QUÉ vehículo entró —marca, modelo, color—, que del
    recorte de la patente no se puede sacar.

    RUTA APARTE Y NO UN PARÁMETRO DE `plate.jpg`

    El contrato de aquélla incluye dibujar el recuadro verde encima. Estos
    mismos bytes son los que se suben al bucket, y un recuadro quemado quedaría
    fuera de lugar en cualquier recorte que se haga después del lado del
    cliente. Además, sin parámetros esta ruta devuelve el archivo tal cual, sin
    decodificar ni recomprimir, en un equipo que además está corriendo el loop
    de captura.

    Con `maxWidth`/`quality` devuelve una versión liviana. Se usa para subir a
    la nube: una vez que el LPR leyó la patente, la imagen sólo sirve para
    auditar a ojo, así que la calidad original no aporta nada. La política
    (cuánto achicar) la decide quien llama, no este servicio.
    """
    if _storage is None:
        raise HTTPException(status_code=503, detail="Storage not ready")
    # El path sale SIEMPRE de la base, nunca de la URL: es lo que evita que
    # alguien pida un archivo arbitrario del disco.
    row = _storage.get(capture_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Capture not found")
    if not os.path.exists(row["path"]):
        raise HTTPException(status_code=404, detail="Image file missing")

    if maxWidth is None and quality is None:
        return FileResponse(row["path"], media_type="image/jpeg")

    if maxWidth is not None and not (160 <= maxWidth <= 4096):
        raise HTTPException(status_code=400, detail="maxWidth fuera de rango")
    if quality is not None and not (1 <= quality <= 95):
        raise HTTPException(status_code=400, detail="quality fuera de rango")

    image = cv2.imread(row["path"])
    if image is None:
        raise HTTPException(status_code=404, detail="Image file missing")
    if maxWidth is not None and image.shape[1] > maxWidth:
        scale = maxWidth / image.shape[1]
        # INTER_AREA es la interpolación correcta para achicar; las otras
        # dejan aliasing justo en los caracteres de la patente.
        image = cv2.resize(
            image, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA
        )
    ok, buf = cv2.imencode(
        ".jpg", image, [cv2.IMWRITE_JPEG_QUALITY, quality if quality else 85]
    )
    if not ok:
        raise HTTPException(status_code=500, detail="Encode failed")
    return Response(content=buf.tobytes(), media_type="image/jpeg")


@app.get("/capture/{capture_id}/plate.jpg")
def capture_plate_image(capture_id: str):
    """Serve the stored frame cropped to the detected plate (JPEG)."""
    if _storage is None:
        raise HTTPException(status_code=503, detail="Storage not ready")
    row = _storage.get(capture_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Capture not found")
    image = cv2.imread(row["path"])
    if image is None:
        raise HTTPException(status_code=404, detail="Image file missing")
    crop = _crop_to_plate(image, row.get("bbox"))
    ok, buf = cv2.imencode(".jpg", crop, _STREAM_JPEG)
    if not ok:
        raise HTTPException(status_code=500, detail="Encode failed")
    return Response(content=buf.tobytes(), media_type="image/jpeg")


@app.delete("/detection/latest", status_code=204)
def detection_latest_clear():
    """Clear the in-memory last detection (call after the operator confirms the entry)."""
    global _last_detection
    _last_detection = None


# ── Hilos de OpenCV ───────────────────────────────────────────────────────────
#
# OpenCV reparte por defecto cada operación entre TODOS los núcleos. Suena
# bien, pero las operaciones de este servicio son chicas —un `cvtColor` de un
# ROI reducido, un `imencode` del preview— y para esos tamaños el costo de
# sincronizar los hilos se come la ganancia.
#
# El problema real es otro: la PC de una playa tiene dos núcleos. Los que
# OpenCV toma para paralelizar una operación de milisegundos son los mismos que
# necesita el decodificador de FFmpeg, que sí escala bien con hilos y es el
# gasto grande del servicio. Dejarle los núcleos al decodificador baja el CPU
# total aunque cada operación individual tarde un poquito más.
#
# Va acá arriba, antes de crear nada: `setNumThreads` afecta sólo a las
# operaciones de OpenCV, no al decodificador de video, que maneja sus hilos por
# su cuenta.
cv2.setNumThreads(1)


if __name__ == "__main__":
    _config = uvicorn.Config(
        app,
        host="127.0.0.1",
        port=PORT,
        log_level="info",
        access_log=False,
        # `timeout_graceful_shutdown`: sin esto, el cierre elegante espera a
        # que TODAS las conexiones abiertas terminen, y el preview MJPEG y el SSE de detecciones no
        # terminan nunca por su cuenta. Resultado: el servicio se quedaba
        # colgado al cerrar la app, Electron se cansaba a los 12 segundos y
        # mandaba un kill que en Windows no alcanzaba (ver `forceKillTree` en
        # electron/services.ts).
        #
        # 5 segundos alcanzan de sobra para cualquier request real; lo que se
        # corta es la espera por las que nunca iban a cerrarse.
        timeout_graceful_shutdown=5,
    )
    _server = uvicorn.Server(_config)
    _server.run()
