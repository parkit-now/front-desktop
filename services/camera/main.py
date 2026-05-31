"""Camera capture microservice — FastAPI entry point.

Usage:
    python main.py [PORT]     # defaults to 8766

Environment variables (all optional):
    CAMERA_SOURCE              Device index or RTSP URL       (default: 0)
    CAMERA_FPS                 Target capture FPS             (default: 10)
    CAMERA_WIDTH               Frame width px                 (default: 1280)
    CAMERA_HEIGHT              Frame height px                (default: 720)
    CAMERA_ID                  Logical camera identifier      (default: cam-01)
    CAMERA_TENANT_ID           Tenant ID for storage path     (default: default)
    CAMERA_LOCATION            "entrada" | "salida"           (default: entrada)
    CAMERA_CAPTURE_INTERVAL    Seconds between LPR calls      (default: 2)
    CAMERA_DB_PATH             SQLite database path           (default: ./camera.db)
    CAMERA_IMAGES_DIR          Base directory for images      (default: ./images)
    CAMERA_WATCHDOG_TIMEOUT    Seconds without frames before reconnect (default: 5)
    LPR_URL                    LPR service base URL           (default: http://127.0.0.1:8765)
"""

import asyncio
import logging
import os
import sys
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

import lpr_client
from capture import CameraCapture
from storage import LocalStorage
from watchdog import CameraWatchdog

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s %(message)s")
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
DB_PATH          = os.environ.get("CAMERA_DB_PATH", "./camera.db")
IMAGES_DIR       = os.environ.get("CAMERA_IMAGES_DIR", "./images")
WATCHDOG_TIMEOUT = int(os.environ.get("CAMERA_WATCHDOG_TIMEOUT", "5"))

# ── Service instances (initialised in lifespan) ───────────────────────────────

_capture:  CameraCapture  | None = None
_storage:  LocalStorage   | None = None
_watchdog: CameraWatchdog | None = None


async def _process_loop() -> None:
    """Grab the latest frame every CAPTURE_INTERVAL seconds, call LPR, persist."""
    loop = asyncio.get_event_loop()
    while True:
        await asyncio.sleep(CAPTURE_INTERVAL)
        frame = _capture.latest_frame()
        if frame is None:
            continue
        img = frame.copy()
        # lpr_client.recognize is a blocking HTTP call — run in a thread pool
        # so it doesn't stall the asyncio event loop.
        result = await loop.run_in_executor(None, lpr_client.recognize, img)
        if result is not None:
            _storage.save(img, CAMERA_ID, CAMERA_LOCATION, lpr_result=result)


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _capture, _storage, _watchdog

    _capture  = CameraCapture(CAMERA_SOURCE, CAMERA_FPS, CAMERA_WIDTH, CAMERA_HEIGHT)
    _storage  = LocalStorage(DB_PATH, IMAGES_DIR, CAMERA_TENANT_ID)
    _watchdog = CameraWatchdog(_capture, WATCHDOG_TIMEOUT)

    _capture.start()
    _watchdog.start()
    task = asyncio.create_task(_process_loop())

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


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=PORT, log_level="info")
