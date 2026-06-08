"""Threaded camera capture via OpenCV.

Runs a dedicated daemon thread that continuously reads frames from the camera
source (USB device index or RTSP URL) into a single-slot deque. The main
thread / asyncio event loop always gets the most recent frame without blocking.
"""

import logging
import threading
import time
from collections import deque

import cv2

logger = logging.getLogger(__name__)


class CameraCapture(threading.Thread):

    def __init__(self, source: str | int, fps: int, width: int, height: int) -> None:
        super().__init__(daemon=True, name="camera-capture")
        # cv2.VideoCapture accepts int for USB device or str for RTSP/file.
        self._source: int | str = int(source) if str(source).isdigit() else source
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

    # ── Internal ──────────────────────────────────────────────────────────────

    def _open(self) -> bool:
        cap = cv2.VideoCapture(self._source)
        if not cap.isOpened():
            cap.release()  # free OS handle even when open failed (RTSP retry leak)
            logger.error("camera_open_failed", extra={"source": self._source})
            return False
        cap.set(cv2.CAP_PROP_FPS, self._fps)
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, self._width)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, self._height)
        self._cap = cap
        logger.info("camera_opened", extra={"source": self._source, "fps": self._fps})
        return True

    # ── Thread entry ──────────────────────────────────────────────────────────

    def run(self) -> None:
        self._open()

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

            ok, frame = self._cap.read()
            if ok:
                self._frames.append(frame)
                self._last_frame_time = time.monotonic()
            else:
                # Stream stalled; yield briefly before retrying.
                time.sleep(0.01)

    # ── Public API ────────────────────────────────────────────────────────────

    def latest_frame(self):
        """Return the most recent BGR frame, or None if none received yet."""
        return self._frames[0] if self._frames else None

    def seconds_since_last_frame(self) -> float | None:
        """Seconds elapsed since the last successful read, or None if never."""
        if self._last_frame_time is None:
            return None
        return time.monotonic() - self._last_frame_time

    def restart(self) -> None:
        """Ask the capture thread to release and reopen the camera source."""
        self._reconnect_requested = True

    def stop(self) -> None:
        self._stop_event.set()
        if self._cap:
            self._cap.release()
