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
    CAMERA_MOTION_COOLDOWN     Seconds between motion triggers      (default: 3.0)
    CAMERA_ROI                 "x1,y1,x2,y2" px, empty=full frame  (default: "")
    CAMERA_FALLBACK_INTERVAL   Seconds between fallback LPR scans  (default: 300)
    CAMERA_MIN_CONFIDENCE      Minimum confidence to save [0–1]     (default: 0.60)
    CAMERA_COOLDOWN            Seconds before saving same plate again (default: 5)
    CAMERA_CLUSTER_WINDOW      Seconds to merge similar detections  (default: 5)
    CAMERA_CLUSTER_SETTLE      Quiet time before saving a cluster   (default: 1.2)
    CAMERA_DB_PATH             SQLite database path                 (default: ./camera.db)
    CAMERA_IMAGES_DIR          Base directory for images            (default: ./images)
    CAMERA_WATCHDOG_TIMEOUT    Seconds without frames before reconnect (default: 5)
    LPR_URL                    LPR service base URL                 (default: http://127.0.0.1:8765)
"""

import asyncio
import hmac
import logging
import os
import sys
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from contextlib import suppress
from datetime import datetime, timezone

import cv2
import uvicorn
from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, StreamingResponse

import lpr_client
from capture import CameraCapture, redact_source
from motion import MotionDetector
from storage import LocalStorage
from watchdog import CameraWatchdog

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)

# ── Config ────────────────────────────────────────────────────────────────────

PORT             = int(sys.argv[1]) if len(sys.argv) > 1 else 8766
SHUTDOWN_TOKEN   = os.environ.get("PARKIT_SHUTDOWN_TOKEN")
CAMERA_SOURCE    = os.environ.get("CAMERA_SOURCE", "0")
CAMERA_FPS       = int(os.environ.get("CAMERA_FPS", "10"))
CAMERA_WIDTH     = int(os.environ.get("CAMERA_WIDTH", "1280"))
CAMERA_HEIGHT    = int(os.environ.get("CAMERA_HEIGHT", "720"))
CAMERA_ID        = os.environ.get("CAMERA_ID", "cam-01")
CAMERA_TENANT_ID = os.environ.get("CAMERA_TENANT_ID", "default")
CAMERA_LOCATION  = os.environ.get("CAMERA_LOCATION", "entrada")
MIN_CONFIDENCE   = float(os.environ.get("CAMERA_MIN_CONFIDENCE", "0.60"))
COOLDOWN         = float(os.environ.get("CAMERA_COOLDOWN", "5.0"))
CLUSTER_WINDOW   = float(os.environ.get("CAMERA_CLUSTER_WINDOW", "5.0"))
CLUSTER_SETTLE   = float(os.environ.get("CAMERA_CLUSTER_SETTLE", "1.2"))
BBOX_CLOSE_RATIO = float(os.environ.get("CAMERA_BBOX_CLOSE_RATIO", "0.35"))
DB_PATH          = os.environ.get("CAMERA_DB_PATH", "./camera.db")
IMAGES_DIR       = os.environ.get("CAMERA_IMAGES_DIR", "./images")
WATCHDOG_TIMEOUT = int(os.environ.get("CAMERA_WATCHDOG_TIMEOUT", "5"))

MOTION_THRESHOLD  = float(os.environ.get("CAMERA_MOTION_THRESHOLD", "1.5"))
MOTION_COOLDOWN   = float(os.environ.get("CAMERA_MOTION_COOLDOWN", "3.0"))
FALLBACK_INTERVAL = float(os.environ.get("CAMERA_FALLBACK_INTERVAL", "300.0"))

STREAM_FPS     = max(1, min(CAMERA_FPS, int(os.environ.get("CAMERA_STREAM_FPS", "12"))))
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
    print(f"  filter   : min_conf={MIN_CONFIDENCE:.0%}  plate_cooldown={COOLDOWN}s")
    print(f"  cluster  : window={CLUSTER_WINDOW:.1f}s  settle={CLUSTER_SETTLE:.1f}s")
    print(f"  API      : http://127.0.0.1:{PORT}")
    print(sep)
    print()


# ── Service instances (initialised in lifespan) ───────────────────────────────

_capture:      CameraCapture  | None = None
_storage:      LocalStorage   | None = None
_watchdog:     CameraWatchdog | None = None
_motion:       MotionDetector | None = None
_lpr_executor: ThreadPoolExecutor | None = None
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


def _normalised(result: dict) -> str:
    return (result.get("normalizedText") or result.get("text") or "").strip().upper()


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


def _plates_similar(a: str, b: str) -> bool:
    if not a or not b:
        return False
    if a == b:
        return True
    if abs(len(a) - len(b)) > 1:
        return False
    return _levenshtein(a, b) <= 1


def _bbox_close(
    a: tuple[int, int, int, int] | None,
    b: tuple[int, int, int, int] | None,
) -> bool:
    if a is None or b is None:
        return False
    ax = (a[0] + a[2]) / 2
    ay = (a[1] + a[3]) / 2
    bx = (b[0] + b[2]) / 2
    by = (b[1] + b[3]) / 2
    aw = max(1, a[2] - a[0])
    ah = max(1, a[3] - a[1])
    bw = max(1, b[2] - b[0])
    bh = max(1, b[3] - b[1])
    scale = max(aw, ah, bw, bh, 1)
    distance = ((ax - bx) ** 2 + (ay - by) ** 2) ** 0.5
    return (distance / scale) <= BBOX_CLOSE_RATIO


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
    }


def _cluster_matches(cluster: dict, candidate: dict, now: float) -> bool:
    if now - cluster["first_seen"] > CLUSTER_WINDOW:
        return False
    best = cluster["best"]
    a = _normalised(best["result"])
    b = _normalised(candidate["result"])
    return _plates_similar(a, b) or _bbox_close(best["bbox"], candidate["bbox"])


def _add_cluster_candidate(result: dict, frame, now: float) -> None:
    candidate = {
        "result": result,
        "frame": frame.copy(),
        "bbox": _bbox_tuple(result),
        "seen_at": now,
    }
    if candidate["bbox"] is None:
        return
    for cluster in _clusters:
        if _cluster_matches(cluster, candidate, now):
            cluster["last_seen"] = now
            cluster["candidates"].append(candidate)
            if _quality_score(candidate) > _quality_score(cluster["best"]):
                cluster["best"] = candidate
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

    now = time.monotonic()
    if normalized:
        last_saved = _last_saved_by_plate.get(normalized, 0)
        remaining = COOLDOWN - (now - last_saved)
        if remaining > 0:
            print(
                f"\r[{_ts()}]  ~  {normalized:<12}  cooldown {remaining:.0f}s              ",
                end="",
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
                flushed.append(event)
        else:
            remaining.append(cluster)
    _clusters[:] = remaining
    return flushed


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
                print(f"\r[{_ts()}]  camera down — pausing LPR...                  ", end="", flush=True)
                continue
            if camera_was_down:
                _motion.reset()
                camera_was_down = False

            frame = _capture.latest_frame()
            if frame is None:
                print(f"\r[{_ts()}]  waiting for camera...                         ", end="", flush=True)
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

            # Reset fallback clock on every actual LPR call (motion or fallback).
            last_fallback = time.monotonic()
            lpr_calls += 1
            print(
                f"\r[{_ts()}]  motion → scanning...  (calls={lpr_calls}, saved={saved})",
                end="",
                flush=True,
            )

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
    global _capture, _storage, _watchdog, _motion, _lpr_executor, _shutting_down

    # Single-worker executor: at most one ONNX inference at a time.
    # On a low-end parking-lot PC this prevents CPU saturation when multiple
    # motion events arrive faster than inference completes.
    _lpr_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="lpr")

    _capture  = CameraCapture(CAMERA_SOURCE, CAMERA_FPS, CAMERA_WIDTH, CAMERA_HEIGHT)
    _storage  = LocalStorage(DB_PATH, IMAGES_DIR, CAMERA_TENANT_ID)
    _watchdog = CameraWatchdog(_capture, WATCHDOG_TIMEOUT)
    _motion   = MotionDetector(MOTION_THRESHOLD, MOTION_COOLDOWN, ROI)

    _snapshot_defaults()
    _capture.start()
    _watchdog.start()
    task = asyncio.create_task(_process_loop())

    _print_banner()
    logger.info(
        "camera_service_started — source=%s location=%s tenant=%s",
        redact_source(CAMERA_SOURCE), CAMERA_LOCATION, CAMERA_TENANT_ID,
    )
    yield

    _shutting_down = True
    task.cancel()
    with suppress(asyncio.CancelledError, asyncio.TimeoutError):
        await asyncio.wait_for(task, timeout=PROCESS_LOOP_SHUTDOWN_TIMEOUT)
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
    return {"status": "ok"}


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


def _mjpeg_frames():
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
        ok, buf = cv2.imencode(".jpg", frame, _STREAM_JPEG)
        if not ok:
            time.sleep(interval)
            continue
        yield boundary + b"Content-Type: image/jpeg\r\n\r\n" + buf.tobytes() + b"\r\n"
        time.sleep(interval)


@app.get("/stream/mjpeg")
def stream_mjpeg():
    """Live MJPEG preview for the desktop UI.

    Devuelve 503 cuando no hay nada que mostrar, en vez de abrir un stream que
    se queda esperando frames para siempre. Sin esto, con la cámara caída el
    <img> del panel nunca dispara `onError` y el operador ve un recuadro en
    blanco hasta que el poll de estado lo note —hasta 10 segundos—. Con una
    cámara de red, que se cae mucho más seguido que un cable USB, esa demora es
    la diferencia entre "está desconectada" y "esta app no anda".
    """
    if _capture is None or _capture.latest_frame() is None:
        raise HTTPException(status_code=503, detail="camera has no frames yet")
    return StreamingResponse(
        _mjpeg_frames(),
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
    "plateCooldown": (float, 0.0, 300.0),
    "fallbackInterval": (float, 10.0, 3600.0),
    # Agrupamiento de lecturas de un mismo auto
    "clusterWindow": (float, 0.5, 60.0),
    "clusterSettle": (float, 0.1, 30.0),
    "bboxCloseRatio": (float, 0.05, 1.0),
    # Captura (width/height/fps solo aplican a webcam: una cámara IP manda lo suyo)
    "fps": (int, 1, 60),
    "width": (int, 160, 7680),
    "height": (int, 120, 4320),
    "watchdogTimeout": (int, 1, 120),
    # Preview
    "streamFps": (int, 1, 30),
    "streamQuality": (int, 10, 100),
}

_GLOBAL_BY_KEY = {
    "motionThreshold": "MOTION_THRESHOLD",
    "motionCooldown": "MOTION_COOLDOWN",
    "minConfidence": "MIN_CONFIDENCE",
    "plateCooldown": "COOLDOWN",
    "fallbackInterval": "FALLBACK_INTERVAL",
    "clusterWindow": "CLUSTER_WINDOW",
    "clusterSettle": "CLUSTER_SETTLE",
    "bboxCloseRatio": "BBOX_CLOSE_RATIO",
    "fps": "CAMERA_FPS",
    "width": "CAMERA_WIDTH",
    "height": "CAMERA_HEIGHT",
    "watchdogTimeout": "WATCHDOG_TIMEOUT",
    "streamFps": "STREAM_FPS",
    "streamQuality": "STREAM_QUALITY",
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

    # STREAM_FPS nunca puede superar el FPS de captura: pedir más cuadros de los
    # que entran solo hace que el generador duerma de más.
    g["STREAM_FPS"] = max(1, min(CAMERA_FPS, STREAM_FPS))
    g["_STREAM_JPEG"] = [cv2.IMWRITE_JPEG_QUALITY, STREAM_QUALITY]

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


@app.get("/detections/pending")
def detections_pending():
    """Plates detected but not yet registered/dismissed by the operator."""
    if _storage is None:
        return []
    return _storage.list_pending_lpr_events()


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
    pad_x = int((x2 - x1) * 0.4)
    pad_y = int((y2 - y1) * 0.6)
    cx1, cy1 = max(0, x1 - pad_x), max(0, y1 - pad_y)
    cx2, cy2 = min(w, x2 + pad_x), min(h, y2 + pad_y)
    crop = image[cy1:cy2, cx1:cx2].copy()
    cv2.rectangle(crop, (x1 - cx1, y1 - cy1), (x2 - cx1, y2 - cy1), (0, 200, 0), 2)
    return crop


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


if __name__ == "__main__":
    _config = uvicorn.Config(app, host="127.0.0.1", port=PORT, log_level="info")
    _server = uvicorn.Server(_config)
    _server.run()
