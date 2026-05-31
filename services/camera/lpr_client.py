"""HTTP client for the LPR microservice.

Encodes a BGR frame as JPEG base64 and POSTs it to the LPR service.
Returns the parsed JSON result on success, None on any failure (service
unreachable, no plate detected, etc.) so callers never need to handle
exceptions from this module.
"""

import base64
import logging
import os

import cv2
import httpx
import numpy as np

LPR_URL = os.environ.get("LPR_URL", "http://127.0.0.1:8765")

logger = logging.getLogger(__name__)


def recognize(frame_bgr: np.ndarray) -> dict | None:
    """Send a BGR frame to the LPR service.

    Returns a dict with keys {plate, text, confidence, bbox} on success,
    or None if no plate was detected or the service is unreachable.
    """
    _, buf = cv2.imencode(".jpg", frame_bgr, [cv2.IMWRITE_JPEG_QUALITY, 85])
    b64 = base64.b64encode(buf).decode()
    try:
        r = httpx.post(f"{LPR_URL}/process", json={"image": b64}, timeout=5.0)
        if r.status_code == 200:
            return r.json()
        # 404 = no plate detected; anything else = unexpected error.
        return None
    except Exception as exc:
        logger.warning("lpr_unreachable", extra={"url": LPR_URL, "error": str(exc)})
        return None
