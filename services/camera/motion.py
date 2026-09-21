"""Frame-differencing motion detector with configurable ROI.

Compares consecutive grayscale frames inside a Region of Interest using
cv2.absdiff. Returns True (plus the full-colour frame that triggered the
detection) when:

  1. The mean absolute pixel difference exceeds the threshold, AND
  2. The inter-trigger cooldown has elapsed.
"""

import time

import cv2
import numpy as np

_ROI_T = tuple[int, int, int, int]


class MotionDetector:

    def __init__(
        self,
        threshold: float,
        cooldown: float,
        roi: _ROI_T | None = None,
        warmup_frames: int = 10,
    ) -> None:
        """
        Args:
            threshold:     Mean absolute pixel diff [0–255] that counts as motion.
                           Typical range: 1.0 (very sensitive) – 5.0 (coarse).
            cooldown:      Minimum seconds between consecutive triggers. Prevents
                           a single vehicle crossing the frame from spawning
                           many LPR calls.
            roi:           (x1, y1, x2, y2) pixel box to analyse, or None for
                           the full frame. Only this region is compared; LPR
                           still receives the full-resolution snapshot.
            warmup_frames: Frames to skip at startup while the camera
                           auto-exposure settles. Default covers ~1 s at 10 FPS.
        """
        self._threshold = threshold
        self._cooldown = cooldown
        self._roi = roi
        self._warmup_frames = warmup_frames
        self._warmup_remaining = warmup_frames
        self._prev_gray: np.ndarray | None = None
        self._last_trigger: float = 0.0

    # ── Public API ────────────────────────────────────────────────────────────

    def check(self, frame: np.ndarray) -> tuple[bool, np.ndarray | None]:
        """Evaluate a new frame for significant motion.

        Returns:
            (True, snapshot)  — motion detected; snapshot is a copy of the
                                full-colour frame at detection time.
            (False, None)     — no trigger (warmup, below threshold, or cooldown).
        """
        gray = self._to_gray_roi(frame)

        # Warmup: populate prev_gray without triggering.
        if self._warmup_remaining > 0:
            self._warmup_remaining -= 1
            self._prev_gray = gray
            return False, None

        if self._prev_gray is None:
            self._prev_gray = gray
            return False, None

        # Cambió la resolución: hay otra cámara del otro lado.
        #
        # `cv2.absdiff` TIRA una excepción si los tamaños no coinciden, y como
        # esto corre dentro del loop de detección, esa excepción mataba la tarea
        # entera: el video seguía viéndose y la detección de patentes quedaba
        # muerta para siempre, sin un solo error a la vista. Pasó al cambiar en
        # caliente de la webcam (1280x720) a una cámara IP (1920x1080).
        #
        # No es un error: es una cámara nueva. Se descarta la referencia vieja y
        # se arranca de cero, igual que en el warmup.
        if self._prev_gray.shape != gray.shape:
            self._prev_gray = gray
            self._warmup_remaining = self._warmup_frames
            return False, None

        diff = cv2.absdiff(self._prev_gray, gray)
        self._prev_gray = gray  # always update so next diff is frame-to-frame

        if float(diff.mean()) < self._threshold:
            return False, None

        now = time.monotonic()
        if now - self._last_trigger < self._cooldown:
            return False, None

        self._last_trigger = now
        return True, frame.copy()

    def reset(self) -> None:
        """Clear accumulated state so the next frames are treated as warmup.

        Call this when the camera reconnects to avoid comparing a new frame
        against a stale reference captured before the connection dropped.
        """
        self._prev_gray = None
        self._warmup_remaining = self._warmup_frames

    # ── Internal ──────────────────────────────────────────────────────────────

    def _to_gray_roi(self, frame: np.ndarray) -> np.ndarray:
        if self._roi is not None:
            x1, y1, x2, y2 = self._roi
            frame = frame[y1:y2, x1:x2]
        return cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
