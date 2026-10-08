"""Threaded camera capture via OpenCV.

Runs a dedicated daemon thread that continuously reads frames from the camera
source (USB device index or RTSP URL) into a single-slot deque. The main
thread / asyncio event loop always gets the most recent frame without blocking.
"""

import logging
import os
import re
import threading
import time
from collections import deque

import cv2

logger = logging.getLogger(__name__)

# Timeouts del backend FFmpeg, en milisegundos.
#
# Sin esto, un `rtsp://` inalcanzable deja el thread colgado DENTRO de
# cv2.VideoCapture() para siempre: el watchdog puede pedir un restart, pero el
# flag recién se lee cuando `_open()` retorna, y nunca retorna. Con una webcam
# USB no pasaba porque el driver falla al instante.
_OPEN_TIMEOUT_MS = 5000
_READ_TIMEOUT_MS = 5000

# `rtsp_transport;tcp` fuerza TCP en vez de UDP. Con UDP, cualquier Wi-Fi flojo
# —el caso típico de una playa— pierde paquetes y entrega frames con artefactos
# que arruinan el OCR de las patentes. El LPR lee una patente rota y la descarta,
# o peor, la lee mal.
_FFMPEG_CAPTURE_OPTIONS = "rtsp_transport;tcp"

# Backoff para cuando el stream está abierto pero no entrega frames. Ver `run()`.
_STALL_SLEEP_MIN = 0.01
_STALL_SLEEP_MAX = 0.5

# La contraseña es todo lo que hay entre el primer ':' y el ÚLTIMO '@' de la
# autoridad (`[^/]*` es greedy y retrocede hasta el último '@'). Con `[^@]*` se
# cortaba en el primer '@' y una contraseña que lo contenga sin escapar —
# malformada, pero que la gente escribe igual— dejaba media clave en el log.
_CREDENTIALS_RE = re.compile(r"://([^:/]+):([^/]*)@")


def redact_source(source: str | int) -> str:
    """Oculta la contraseña de una URL antes de loguearla o devolverla por HTTP.

    `rtsp://admin:s3cr3t@192.168.1.26:554/h264` → `rtsp://admin:***@192.168.1.26:554/h264`

    La credencial de la cámara viaja dentro de la URL, así que sin esto termina
    en texto plano en `userData/logs/services/camera-service.log`, que es un
    archivo que cualquiera puede abrir y que se adjunta a un reporte de soporte.
    """
    if isinstance(source, int):
        return str(source)
    return _CREDENTIALS_RE.sub(r"://\1:***@", str(source))


def _normalize_source(source: str | int) -> int | str:
    """`"0"` → `0` (webcam USB); cualquier otra cosa queda como string (RTSP/archivo)."""
    return int(source) if str(source).isdigit() else source


class CameraCapture(threading.Thread):

    def __init__(self, source: str | int, fps: int, width: int, height: int) -> None:
        super().__init__(daemon=True, name="camera-capture")
        # cv2.VideoCapture accepts int for USB device or str for RTSP/file.
        self._source: int | str = _normalize_source(source)
        self._fps = fps
        self._width = width
        self._height = height
        # maxlen=1: we only care about the latest frame.
        self._frames: deque = deque(maxlen=1)
        self._last_frame_time: float | None = None
        self._stop_event = threading.Event()
        # Watchdog sets this flag to trigger a reconnect from within the thread.
        self._reconnect_requested = False
        self._cap: cv2.VideoCapture | None = None
        # Protege `_source` contra el cambio en caliente desde /config/source.
        self._source_lock = threading.Lock()
        # Se incrementa en cada cambio de fuente. Un frame leído bajo una
        # generación vieja se descarta: ver la carrera explicada en run().
        self._generation = 0

    # ── Internal ──────────────────────────────────────────────────────────────

    def _open(self) -> bool:
        with self._source_lock:
            source = self._source
        is_network = isinstance(source, str)

        if is_network:
            # Tiene que estar seteada ANTES de construir el VideoCapture: FFmpeg
            # lee estas opciones al abrir, no después.
            os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = _FFMPEG_CAPTURE_OPTIONS
            cap = cv2.VideoCapture(source, cv2.CAP_FFMPEG, _open_params())
        else:
            cap = cv2.VideoCapture(source)

        if not cap.isOpened():
            cap.release()  # free OS handle even when open failed (RTSP retry leak)
            logger.error("camera_open_failed", extra={"source": redact_source(source)})
            return False

        if is_network:
            # La cámara IP manda su propia resolución y FPS: pedírselos por
            # CAP_PROP es un no-op silencioso.
            #
            # OJO: este `set` TAMBIÉN es un no-op. `CAP_PROP_BUFFERSIZE` no está
            # implementado en el backend FFMPEG —es de DSHOW/V4L2/GStreamer— y
            # la llamada devuelve False. Se deja porque no molesta y porque
            # documenta la intención, pero NO es lo que mantiene el stream al
            # día.
            #
            # Lo que de verdad evita que el LPR analice una imagen vieja es el
            # loop caliente de `read()` de `run()`, que consume los frames al
            # ritmo que los manda la cámara. Si alguna vez se piensa en "dormir
            # entre lecturas" para ahorrar CPU, no hay red de contención: el
            # buffer de FFmpeg se llena y las patentes que se analizan pasan a
            # ser de hace varios segundos. Para ahorrar CPU, bajarle los FPS a
            # la cámara; no dormir acá.
            cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        else:
            cap.set(cv2.CAP_PROP_FPS, self._fps)
            cap.set(cv2.CAP_PROP_FRAME_WIDTH, self._width)
            cap.set(cv2.CAP_PROP_FRAME_HEIGHT, self._height)

        self._cap = cap
        logger.info(
            "camera_opened",
            extra={"source": redact_source(source), "fps": self._fps},
        )
        return True

    # ── Thread entry ──────────────────────────────────────────────────────────

    def run(self) -> None:
        self._open()
        stall_sleep = _STALL_SLEEP_MIN

        while not self._stop_event.is_set():
            if self._reconnect_requested:
                self._reconnect_requested = False
                if self._cap:
                    self._cap.release()
                    self._cap = None
                self._open()
                continue

            if self._cap is None:
                # Camera not available yet; wait for watchdog to signal restart.
                time.sleep(0.1)
                continue

            # CARRERA A EVITAR: `read()` bloquea, y mientras tanto otro thread
            # puede cambiar la fuente. Si al volver guardáramos el frame igual,
            # estaríamos publicando una imagen de la cámara ANTERIOR después de
            # haber cambiado — y como reabrir la nueva puede tardar segundos, el
            # preview sigue mostrando la vieja y parece que el cambio no se
            # aplicó. Comparar la generación descarta ese frame.
            generation = self._generation
            ok, frame = self._cap.read()
            if ok and generation == self._generation:
                self._frames.append(frame)
                self._last_frame_time = time.monotonic()
                stall_sleep = _STALL_SLEEP_MIN
            elif not ok:
                # El stream está ABIERTO pero no entrega. Antes esto dormía
                # 10 ms fijos, o sea hasta 100 `read()` por segundo —cada uno
                # entrando al demuxer de FFmpeg— durante los hasta 30 s que
                # tarda el watchdog en forzar la reconexión. En una PC de dos
                # núcleos eso se nota, y se nota justo cuando la cámara ya está
                # fallando.
                #
                # El backoff sube hasta medio segundo y se resetea en cuanto
                # vuelve un frame, así que la recuperación sigue siendo
                # inmediata: lo único que se pierde es la insistencia inútil.
                time.sleep(stall_sleep)
                stall_sleep = min(stall_sleep * 2, _STALL_SLEEP_MAX)

    # ── Public API ────────────────────────────────────────────────────────────

    def latest_frame(self):
        """Return the most recent BGR frame, or None if none received yet."""
        return self._frames[0] if self._frames else None

    def seconds_since_last_frame(self) -> float | None:
        """Seconds elapsed since the last successful read, or None if never."""
        if self._last_frame_time is None:
            return None
        return time.monotonic() - self._last_frame_time

    @property
    def source(self) -> int | str:
        with self._source_lock:
            return self._source

    def set_source(self, source: str | int) -> None:
        """Apunta a otra cámara y reconecta, sin reiniciar el proceso.

        El cambio lo aplica el propio thread de captura en su próxima vuelta
        (vía `restart()`), para no liberar el VideoCapture desde afuera mientras
        `read()` lo está usando.
        """
        normalized = _normalize_source(source)
        with self._source_lock:
            if normalized == self._source:
                # Ya está apuntando ahí. Reconectar igual cortaría el video unos
                # segundos sin razón: pasa cada vez que la app arranca y le
                # reenvía al servicio la misma cámara que ya tenía configurada.
                return
            self._source = normalized
            # Invalida cualquier read() en vuelo sobre la cámara anterior.
            self._generation += 1
        # La cámara nueva todavía no entregó nada: descartar el último frame y el
        # sello de tiempo de la anterior. Si no, el watchdog compara contra la
        # cámara vieja y `/stream/mjpeg` seguiría sirviendo su última imagen,
        # que es justo lo que hace dudar de si el cambio se aplicó.
        self._frames.clear()
        self._last_frame_time = None
        self.restart()

    def restart(self) -> None:
        """Ask the capture thread to release and reopen the camera source."""
        self._reconnect_requested = True

    def probe(self) -> dict:
        """Abrir la fuente, leer un frame y cerrar. Nunca tira.

        Pensado para instancias descartables (`CameraCapture(url, ...).probe()`),
        no para la captura en curso: abre su propio VideoCapture y lo libera.
        No alcanza con que `isOpened()` diga True — una URL RTSP con la ruta
        equivocada abre y después no entrega un solo frame, que para el operador
        es el mismo síntoma que no conectar.
        """
        if not self._open():
            return {"ok": False, "error": "no_se_pudo_conectar"}
        try:
            ok, frame = self._cap.read() if self._cap else (False, None)
            if not ok or frame is None:
                return {"ok": False, "error": "conecta_pero_no_entrega_video"}
            height, width = frame.shape[:2]
            return {"ok": True, "width": int(width), "height": int(height)}
        finally:
            if self._cap:
                self._cap.release()
                self._cap = None

    def stop(self, timeout: float = 2.0) -> None:
        self._stop_event.set()
        if self._cap:
            self._cap.release()
            self._cap = None
        if threading.current_thread() is not self and self.is_alive():
            self.join(timeout=timeout)


def _open_params() -> list[int]:
    """Params del constructor de VideoCapture para el backend FFmpeg.

    Se pasan por constructor y no con `cap.set()` porque los timeouts tienen que
    estar vigentes DURANTE la apertura, que es justo lo que queremos acotar.
    Se consultan con `getattr` porque son propiedades relativamente nuevas de
    OpenCV: si el build no las tiene, se abre sin timeout en vez de explotar.
    """
    params: list[int] = []
    open_timeout = getattr(cv2, "CAP_PROP_OPEN_TIMEOUT_MSEC", None)
    read_timeout = getattr(cv2, "CAP_PROP_READ_TIMEOUT_MSEC", None)
    if open_timeout is not None:
        params += [int(open_timeout), _OPEN_TIMEOUT_MS]
    if read_timeout is not None:
        params += [int(read_timeout), _READ_TIMEOUT_MS]

    # Decodificación por hardware (D3D11VA/DXVA2 en Windows, VA-API en Linux).
    #
    # Decodificar 2560×1440 por software es el gasto más grande del servicio, y
    # la PC de la playa tiene dos núcleos. Si la GPU puede hacerlo, el ahorro es
    # enorme.
    #
    # `VIDEO_ACCELERATION_ANY` pide "usá lo que haya" y **cae en silencio a
    # software** si el build de OpenCV no lo trae o el equipo no tiene GPU
    # capaz: nunca falla, como mucho no hace nada. Por eso hay que MEDIR el CPU
    # antes y después en vez de asumir que sirvió.
    #
    # Importa el códec: H.264 lo acelera prácticamente cualquier GPU; H.265 es
    # mucho más desparejo. Ver la guía del dueño.
    hw_accel = getattr(cv2, "CAP_PROP_HW_ACCELERATION", None)
    accel_any = getattr(cv2, "VIDEO_ACCELERATION_ANY", None)
    if hw_accel is not None and accel_any is not None:
        params += [int(hw_accel), int(accel_any)]

    return params
