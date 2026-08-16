"""Camera watchdog: detects frame stalls and drives exponential-backoff reconnects.

The watchdog runs as a daemon thread alongside CameraCapture. Every second it
checks how long ago the last frame arrived. If that gap exceeds TIMEOUT seconds
it marks the camera as "down", signals CameraCapture.restart(), and waits an
exponentially increasing delay before the next attempt (capped at 30 s).

When frames resume the camera is marked "ok" and counters reset.

Backoff schedule (seconds): 1 → 2 → 4 → 8 → 30 → 30 → ...
"""

import logging
import threading
import time
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

_BACKOFF = [1, 2, 4, 8, 30]


class CameraWatchdog(threading.Thread):

    def __init__(self, capture, timeout: int) -> None:
        """
        Args:
            capture: CameraCapture instance to monitor and restart.
            timeout: Seconds without a new frame before declaring camera down.
        """
        super().__init__(daemon=True, name="camera-watchdog")
        self._capture = capture
        self._timeout = timeout
        self._stop_event = threading.Event()
        self._down = False
        self._down_since: str | None = None
        self._attempts = 0

    # ── Thread entry ──────────────────────────────────────────────────────────

    def run(self) -> None:
        started_at = time.monotonic()
        while not self._stop_event.is_set():
            secs = self._capture.seconds_since_last_frame()
            # None means no frame has arrived yet. Only treat it as stalled
            # after the grace period (== timeout) so the camera has time to
            # open on startup without triggering a spurious reconnect.
            if secs is None:
                stalled = (time.monotonic() - started_at) > self._timeout
            else:
                stalled = secs > self._timeout

            if stalled:
                if not self._down:
                    self._down = True
                    self._down_since = datetime.now(timezone.utc).isoformat()
                    logger.warning(
                        "camera_down",
                        extra={"timeout_s": self._timeout, "down_since": self._down_since},
                    )

                delay = _BACKOFF[min(self._attempts, len(_BACKOFF) - 1)]
                logger.info(
                    "camera_reconnect",
                    extra={"attempt": self._attempts, "delay_s": delay},
                )
                self._capture.restart()
                self._attempts += 1
                time.sleep(delay)

            else:
                if self._down:
                    logger.info(
                        "camera_recovered",
                        extra={"total_attempts": self._attempts},
                    )
                    self._down = False
                    self._down_since = None
                    self._attempts = 0
                time.sleep(1)

    # ── Public API ────────────────────────────────────────────────────────────

    def status(self) -> dict:
        """Return current camera status for the /stream/status endpoint."""
        return {
            "camera": "down" if self._down else "ok",
            "down_since": self._down_since,
            "reconnect_attempts": self._attempts,
        }

    def stop(self, timeout: float = 2.0) -> None:
        self._stop_event.set()
        if threading.current_thread() is not self and self.is_alive():
            self.join(timeout=timeout)
