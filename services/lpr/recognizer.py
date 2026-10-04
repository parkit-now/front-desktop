"""License plate recognition via fast-alpr (ONNX, CPU-friendly).

Replaces the previous YOLOv8 + EasyOCR (PyTorch) stack with ankandrew's
fast-alpr, which bundles an ONNX plate detector (``open-image-models``) and an
ONNX OCR model (``fast-plate-ocr``). No PyTorch means a far smaller bundle and
fast inference on the modest CPUs found at parking-lot front desks — where a
discrete GPU cannot be assumed.

Everything is configurable via env vars so we can A/B models or opt into GPU /
OpenVINO acceleration on the few machines that have it, without touching code:

    LPR_DETECTOR_MODEL   detector name (open-image-models hub)
    LPR_OCR_MODEL        OCR name (fast-plate-ocr hub)
    LPR_DETECTOR_CONF    detection confidence threshold [0, 1]  (default 0.4)
    LPR_ONNX_PROVIDERS   comma-separated onnxruntime providers  (default CPU)
    LPR_OCR_DEVICE       "cpu" | "cuda" | "auto"                (default cpu)
    LPR_REFINE           second detection pass on a crop        (default 1)
"""

import os
import re
import shutil
import sys
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from fast_alpr import ALPR

# ── Model selection ───────────────────────────────────────────────────────────
# Detector: ONNX YOLO-v9 plate localiser from open-image-models.
# OCR: CCT model from fast-plate-ocr. "cct-s-v2-global-model" is the author's
# recommended default for new integrations: a CCT transformer trained on 65+
# countries (Argentina included — Mercosur AB123CD and old ABC123 formats) that
# is both faster (~0.7 ms) and more accurate than the legacy Argentina-only CNN
# models ("argentinian-plates-cnn-*", ~94% plate_acc, ~2.1 ms, now deprecated by
# upstream). To benchmark the legacy AR model on real footage, set
# LPR_OCR_MODEL=argentinian-plates-cnn-synth-model.
DETECTOR_MODEL = os.environ.get("LPR_DETECTOR_MODEL", "yolo-v9-t-384-license-plate-end2end")
OCR_MODEL = os.environ.get("LPR_OCR_MODEL", "cct-s-v2-global-model")
DETECTOR_CONF = float(os.environ.get("LPR_DETECTOR_CONF", "0.4"))
QUALITY_LOW_CONFIDENCE = float(os.environ.get("LPR_QUALITY_LOW_CONFIDENCE", "0.60"))
QUALITY_HIGH_CONFIDENCE = float(os.environ.get("LPR_QUALITY_HIGH_CONFIDENCE", "0.80"))

# ── Second detection pass ─────────────────────────────────────────────────────
# The detector letterboxes the WHOLE input down to 384 px. On a 2560x1440
# camera, even a cropped detection zone of ~1800 px shrinks a 115 px plate to
# ~24 px, and at that size the box comes back misplaced: measured on a real
# install, it cut "IA" off "IAG 574" and grabbed the sticker next to it, so the
# OCR read "G577". The same image cropped to 800 px read "IAG 574" at 0.85.
#
# So after the first pass, each detection is re-run on a crop around it, where
# the plate is several times bigger, and the better of the two readings wins.
REFINE_ENABLED = os.environ.get("LPR_REFINE", "1").strip().lower() not in ("0", "false", "no", "off")
# Context kept around the first box, in plate widths / heights per side. Wide
# enough to contain the whole plate even when the first box is off by a third
# of its width, which is the error seen in the field.
REFINE_PAD_X = 1.0
REFINE_PAD_Y = 1.5
# Only refine when the crop is meaningfully smaller than the input: otherwise
# the detector sees the plate at about the same scale and the pass is wasted.
REFINE_MAX_CROP_RATIO = 0.6

# CPU by default for maximum portability. Override to e.g.
# "OpenVINOExecutionProvider,CPUExecutionProvider" or "CUDAExecutionProvider".
_PROVIDERS = [p.strip() for p in os.environ.get("LPR_ONNX_PROVIDERS", "CPUExecutionProvider").split(",") if p.strip()]
_OCR_DEVICE = os.environ.get("LPR_OCR_DEVICE", "cpu")

# Where each library caches its models (hardcoded in the libs to ~/.cache/...).
_OIM_CACHE = Path.home() / ".cache" / "open-image-models"
_FPO_CACHE = Path.home() / ".cache" / "fast-plate-ocr"

# Argentina plate formats (normalised: no spaces/dashes, uppercase).
_OLD_RE = re.compile(r"^[A-Z]{3}[0-9]{3}$")              # ABC123  (pre-2016)
_MERCOSUR_RE = re.compile(r"^[A-Z]{2}[0-9]{3}[A-Z]{2}$")  # AB123CD (2016+)


@dataclass
class Recognition:
    plate: str          # display form, e.g. "AB 123 CD"
    text: str           # normalised, e.g. "AB123CD"
    raw_text: str       # OCR output before normalisation
    format_valid: bool
    format_type: str    # argentina_old | argentina_mercosur | unknown
    quality_status: str # valid_high | valid_low | invalid_format | low_confidence
    confidence: float   # composite [0, 1]
    bbox: tuple[int, int, int, int]  # x1, y1, x2, y2 in source image


def _seed_offline_cache() -> None:
    """When running as a PyInstaller bundle, pre-seed the model caches.

    Both libraries skip the network download when the files already exist in
    ``~/.cache/<lib>/<model>/``. The bundle ships the same layout under
    ``models/`` (see build.spec), so copying it across makes the frozen binary
    fully offline on first run.
    """
    if not getattr(sys, "frozen", False):
        return
    bundled = Path(sys._MEIPASS) / "models"  # type: ignore[attr-defined]
    for src_name, dst in (("open-image-models", _OIM_CACHE), ("fast-plate-ocr", _FPO_CACHE)):
        src = bundled / src_name
        if src.is_dir() and not dst.exists():
            shutil.copytree(src, dst)


def _normalise(raw: str) -> str:
    """Strip spaces/dashes/pad chars and uppercase."""
    return raw.replace(" ", "").replace("-", "").replace("_", "").upper()


def _format_plate(t: str) -> str:
    """Return display form with canonical spaces when the text matches a format."""
    if _OLD_RE.match(t):
        return f"{t[:3]} {t[3:]}"           # ABC 123
    if _MERCOSUR_RE.match(t):
        return f"{t[:2]} {t[2:5]} {t[5:]}"  # AB 123 CD
    return t


def _format_type(t: str) -> str:
    if _OLD_RE.match(t):
        return "argentina_old"
    if _MERCOSUR_RE.match(t):
        return "argentina_mercosur"
    return "unknown"


def _quality_status(format_valid: bool, confidence: float) -> str:
    if not format_valid:
        return "invalid_format"
    if confidence < QUALITY_LOW_CONFIDENCE:
        return "low_confidence"
    if confidence < QUALITY_HIGH_CONFIDENCE:
        return "valid_low"
    return "valid_high"


def _mean_conf(confidence: float | list[float]) -> float:
    """fast-plate-ocr returns either one score or one per character."""
    if isinstance(confidence, (list, tuple)):
        return float(np.mean(confidence)) if len(confidence) else 0.0
    return float(confidence)


Box = tuple[int, int, int, int]


def _clip_box(box: Box, width: int, height: int) -> Box | None:
    x1, y1, x2, y2 = box
    x1, y1 = max(int(x1), 0), max(int(y1), 0)
    x2, y2 = min(int(x2), width), min(int(y2), height)
    if x2 <= x1 or y2 <= y1:
        return None
    return x1, y1, x2, y2


def _refine_window(box: Box, width: int, height: int) -> Box | None:
    """Crop to re-detect in, or None when it would not enlarge the plate."""
    x1, y1, x2, y2 = box
    bw, bh = x2 - x1, y2 - y1
    if bw <= 0 or bh <= 0:
        return None
    window = _clip_box(
        (
            round(x1 - bw * REFINE_PAD_X),
            round(y1 - bh * REFINE_PAD_Y),
            round(x2 + bw * REFINE_PAD_X),
            round(y2 + bh * REFINE_PAD_Y),
        ),
        width,
        height,
    )
    if window is None:
        return None
    wx1, wy1, wx2, wy2 = window
    # The detector scales by the LONGER side, so that is what has to shrink.
    if max(wx2 - wx1, wy2 - wy1) > REFINE_MAX_CROP_RATIO * max(width, height):
        return None
    return window


def _overlaps(a: Box, b: Box) -> bool:
    return a[0] < b[2] and b[0] < a[2] and a[1] < b[3] and b[1] < a[3]


def _pick_refined(first: Box, window: Box, detections) -> tuple[Box, float] | None:
    """The re-detected box that stands for the first one, in image coordinates.

    The crop may catch a second plate (a car right behind): only boxes that
    overlap the first one count, and of those the most confident wins.
    """
    ox, oy = window[0], window[1]
    best: tuple[Box, float] | None = None
    for detection in detections:
        bb = detection.bounding_box
        box = (bb.x1 + ox, bb.y1 + oy, bb.x2 + ox, bb.y2 + oy)
        if not _overlaps(box, first):
            continue
        if best is None or detection.confidence > best[1]:
            best = (box, float(detection.confidence))
    return best


def _better(a: "Recognition | None", b: "Recognition | None") -> "Recognition | None":
    """A plate in a valid format beats any invalid read; then confidence decides."""
    if a is None:
        return b
    if b is None:
        return a
    return max(a, b, key=lambda r: (r.format_valid, r.confidence))


class PlateRecognizer:
    """Wraps fast-alpr's detect-then-OCR pipeline behind a simple call."""

    def __init__(self) -> None:
        _seed_offline_cache()
        self._alpr = ALPR(
            detector_model=DETECTOR_MODEL,
            detector_conf_thresh=DETECTOR_CONF,
            detector_providers=_PROVIDERS,
            ocr_model=OCR_MODEL,
            ocr_device=_OCR_DEVICE,
            ocr_providers=_PROVIDERS,
        )

    def warmup(self) -> None:
        """Prime the ONNX sessions so the first real request isn't slow."""
        self._alpr.predict(np.zeros((384, 384, 3), dtype=np.uint8))

    def recognize(self, image: np.ndarray) -> Recognition | None:
        """Return the best readable plate in a BGR image, or None."""
        height, width = image.shape[:2]
        best: Recognition | None = None
        for detection in self._alpr.detector.predict(image):
            bb = detection.bounding_box
            box = _clip_box((bb.x1, bb.y1, bb.x2, bb.y2), width, height)
            if box is None:
                continue
            reading = self._read(image, box, float(detection.confidence))
            if REFINE_ENABLED:
                reading = _better(reading, self._refine(image, box))
            # Across plates confidence alone decides, as before: a valid but
            # shaky plate in the background must not beat the car in front.
            if reading is not None and (best is None or reading.confidence > best.confidence):
                best = reading
        return best

    def _refine(self, image: np.ndarray, box: Box) -> Recognition | None:
        height, width = image.shape[:2]
        window = _refine_window(box, width, height)
        if window is None:
            return None
        wx1, wy1, wx2, wy2 = window
        picked = _pick_refined(box, window, self._alpr.detector.predict(image[wy1:wy2, wx1:wx2]))
        if picked is None:
            return None
        refined, confidence = picked
        refined = _clip_box(refined, width, height)
        if refined is None:
            return None
        return self._read(image, refined, confidence)

    def _read(self, image: np.ndarray, box: Box, detection_confidence: float) -> Recognition | None:
        x1, y1, x2, y2 = box
        ocr = self._alpr.ocr.predict(image[y1:y2, x1:x2])
        if ocr is None:
            return None
        raw_text = ocr.text
        text = _normalise(raw_text)
        if not text:
            return None
        # Honest composite: detector quality × OCR quality. No format-based
        # fudge factor — the OCR head already knows the plate alphabet.
        confidence = round(min(detection_confidence * _mean_conf(ocr.confidence), 1.0), 3)
        format_type = _format_type(text)
        format_valid = format_type != "unknown"
        return Recognition(
            plate=_format_plate(text),
            text=text,
            raw_text=raw_text,
            format_valid=format_valid,
            format_type=format_type,
            quality_status=_quality_status(format_valid, confidence),
            confidence=confidence,
            bbox=box,
        )
