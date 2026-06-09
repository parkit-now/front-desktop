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
    plate: str        # display form, e.g. "AB 123 CD"
    text: str         # normalised, e.g. "AB123CD"
    confidence: float  # composite [0, 1]
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


def _mean_conf(confidence: float | list[float]) -> float:
    """fast-plate-ocr returns either one score or one per character."""
    if isinstance(confidence, (list, tuple)):
        return float(np.mean(confidence)) if len(confidence) else 0.0
    return float(confidence)


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
        best: Recognition | None = None
        for r in self._alpr.predict(image):
            if r.ocr is None:
                continue
            text = _normalise(r.ocr.text)
            if not text:
                continue
            # Honest composite: detector quality × OCR quality. No format-based
            # fudge factor — the OCR head already knows the plate alphabet.
            confidence = round(min(r.detection.confidence * _mean_conf(r.ocr.confidence), 1.0), 3)
            bb = r.detection.bounding_box
            candidate = Recognition(
                plate=_format_plate(text),
                text=text,
                confidence=confidence,
                bbox=(bb.x1, bb.y1, bb.x2, bb.y2),
            )
            if best is None or candidate.confidence > best.confidence:
                best = candidate
        return best
