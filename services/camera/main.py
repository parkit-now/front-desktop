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
    CAMERA_CAPTURE_INTERVAL    Seconds between LPR calls            (default: 2)
    CAMERA_MIN_CONFIDENCE      Minimum confidence to save [0–1]     (default: 0.60)
    CAMERA_COOLDOWN            Seconds before saving same plate again (default: 5)
    CAMERA_DB_PATH             SQLite database path                 (default: ./camera.db)
    CAMERA_IMAGES_DIR          Base directory for images            (default: ./images)
    CAMERA_WATCHDOG_TIMEOUT    Seconds without frames before reconnect (default: 5)
    LPR_URL                    LPR service base URL                 (default: http://127.0.0.1:8765)
"""

import asyncio
import logging
import os
import sys
import time
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

import lpr_client
from capture import CameraCapture
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
CAMERA_SOURCE    = os.environ.get("CAMERA_SOURCE", "0")
CAMERA_FPS       = int(os.environ.get("CAMERA_FPS", "10"))
CAMERA_WIDTH     = int(os.environ.get("CAMERA_WIDTH", "1280"))
CAMERA_HEIGHT    = int(os.environ.get("CAMERA_HEIGHT", "720"))
CAMERA_ID        = os.environ.get("CAMERA_ID", "cam-01")
CAMERA_TENANT_ID = os.environ.get("CAMERA_TENANT_ID", "default")
CAMERA_LOCATION  = os.environ.get("CAMERA_LOCATION", "entrada")
CAPTURE_INTERVAL = float(os.environ.get("CAMERA_CAPTURE_INTERVAL", "2"))
MIN_CONFIDENCE   = float(os.environ.get("CAMERA_MIN_CONFIDENCE", "0.60"))
COOLDOWN         = float(os.environ.get("CAMERA_COOLDOWN", "5.0"))
DB_PATH          = os.environ.get("CAMERA_DB_PATH", "./camera.db")
IMAGES_DIR       = os.environ.get("CAMERA_IMAGES_DIR", "./images")
WATCHDOG_TIMEOUT = int(os.environ.get("CAMERA_WATCHDOG_TIMEOUT", "5"))

_BAR_WIDTH = 20


def _conf_bar(confidence: float) -> str:
    filled = int(confidence * _BAR_WIDTH)
    return "█" * filled + "░" * (_BAR_WIDTH - filled)


def _ts() -> str:
    return time.strftime("%H:%M:%S")


def _print_banner() -> None:
    w = 56
    sep = "─" * w
    print(sep)
    print(f"  Parkit — Camera Service")
    print(sep)
    print(f"  camera   : {CAMERA_ID}  (source: {CAMERA_SOURCE})")
    print(f"  location : {CAMERA_LOCATION}  |  tenant: {CAMERA_TENANT_ID}")
    print(f"  LPR      : {lpr_client.LPR_URL}")
    print(f"  storage  : {IMAGES_DIR}  |  {DB_PATH}")
    print(f"  interval : {CAPTURE_INTERVAL}s  |  min_conf: {MIN_CONFIDENCE:.0%}  |  cooldown: {COOLDOWN}s")
    print(f"  API      : http://127.0.0.1:{PORT}")
    print(sep)
    print()

# ── Service instances (initialised in lifespan) ───────────────────────────────

_capture:  CameraCapture  | None = None
_storage:  LocalStorage   | None = None
_watchdog: CameraWatchdog | None = None

# Last successful detection — read by GET /detection/latest.
_last_detection: dict | None = None

# Deduplication state — avoid saving bursts of the same plate.
_last_saved_plate: str | None = None
_last_saved_at: float = 0.0


async def _process_loop() -> None:
    """Grab the latest frame every CAPTURE_INTERVAL seconds, call LPR, persist.

    Filtering pipeline per frame:
      1. Skip if no frame available (camera not ready).
      2. Call LPR — skip if no plate detected or service unreachable.
      3. Skip if confidence < MIN_CONFIDENCE (likely a false positive).
      4. Skip if the same plate was saved within COOLDOWN seconds (dedup).
      5. Save image + metadata; update _last_detection.
    """
    global _last_detection, _last_saved_plate, _last_saved_at
    loop = asyncio.get_event_loop()
    lpr_calls = 0
    saved = 0

    while True:
        await asyncio.sleep(CAPTURE_INTERVAL)
        frame = _capture.latest_frame()
        if frame is None:
            print(f"\r[{_ts()}]  waiting for camera...                    ", end="", flush=True)
            continue

        lpr_calls += 1
        print(f"\r[{_ts()}]  scanning...  (calls={lpr_calls}, saved={saved})", end="", flush=True)

        img = frame.copy()
        # lpr_client.recognize is a blocking HTTP call — run in a thread pool
        # so it doesn't stall the asyncio event loop.
        result = await loop.run_in_executor(None, lpr_client.recognize, img)

        if result is None:
            continue

        plate = result["plate"]
        conf  = result["confidence"]

        # 1. Confidence filter
        if conf < MIN_CONFIDENCE:
            print(f"\r[{_ts()}]  low conf  {plate:<12}  [{_conf_bar(conf)}] {conf:.0%}  (skipped)", flush=True)
            continue

        # 2. Deduplication cooldown
        now = time.monotonic()
        remaining = COOLDOWN - (now - _last_saved_at)
        if plate == _last_saved_plate and remaining > 0:
            print(f"\r[{_ts()}]  ~  {plate:<12}  cooldown {remaining:.0f}s              ", end="", flush=True)
            _last_detection = {
                "capture_id": None,
                "plate":      plate,
                "text":       result["text"],
                "confidence": conf,
                "location":   CAMERA_LOCATION,
                "camera_id":  CAMERA_ID,
            }
            continue

        # 3. Save
        try:
            capture_id = _storage.save(img, CAMERA_ID, CAMERA_LOCATION, lpr_result=result)
        except IOError as exc:
            logger.error("capture_save_failed", extra={"error": str(exc)})
            continue
        saved += 1
        _last_saved_plate = plate
        _last_saved_at = now
        _last_detection = {
            "capture_id": capture_id,
            "plate":      plate,
            "text":       result["text"],
            "confidence": conf,
            "location":   CAMERA_LOCATION,
            "camera_id":  CAMERA_ID,
        }
        print(f"\r[{_ts()}]  DETECTED  {plate:<12}  [{_conf_bar(conf)}] {conf:.0%}  saved={saved}", flush=True)


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _capture, _storage, _watchdog

    _capture  = CameraCapture(CAMERA_SOURCE, CAMERA_FPS, CAMERA_WIDTH, CAMERA_HEIGHT)
    _storage  = LocalStorage(DB_PATH, IMAGES_DIR, CAMERA_TENANT_ID)
    _watchdog = CameraWatchdog(_capture, WATCHDOG_TIMEOUT)

    _capture.start()
    _watchdog.start()
    task = asyncio.create_task(_process_loop())

    _print_banner()
    logger.info(
        "camera_service_started — source=%s location=%s tenant=%s",
        CAMERA_SOURCE, CAMERA_LOCATION, CAMERA_TENANT_ID,
    )
    yield

    task.cancel()
    _watchdog.stop()
    _capture.stop()


# ── App ───────────────────────────────────────────────────────────────────────

app = FastAPI(title="Camera Service", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/stream/status")
def stream_status():
    if _watchdog is None:
        return {"camera": "initializing", "down_since": None, "reconnect_attempts": 0}
    return _watchdog.status()


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
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="No plate detected yet")
    return _last_detection


@app.delete("/detection/latest", status_code=204)
def detection_latest_clear():
    """Clear the in-memory last detection (call after the operator confirms the entry)."""
    global _last_detection
    _last_detection = None


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=PORT, log_level="info")
