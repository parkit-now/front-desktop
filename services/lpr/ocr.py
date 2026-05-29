"""EasyOCR-based text extraction with Argentina plate post-processing."""

import re
import sys
from dataclasses import dataclass
from pathlib import Path

import easyocr
import numpy as np

_BASE = Path(sys._MEIPASS) if getattr(sys, "frozen", False) else Path(__file__).parent
_EASYOCR_MODELS_DIR = _BASE / "models" / "easyocr"

# Argentina plate regexes (spaces optional — normalise first).
_OLD_RE = re.compile(r"^[A-Z]{3}[0-9]{3}$")        # ABC123  (pre-2016)
_MERCOSUR_RE = re.compile(r"^[A-Z]{2}[0-9]{3}[A-Z]{2}$")  # AB123CD (2016+)

_reader: easyocr.Reader | None = None


def _get_reader() -> easyocr.Reader:
    global _reader
    if _reader is None:
        _EASYOCR_MODELS_DIR.mkdir(parents=True, exist_ok=True)
        _reader = easyocr.Reader(
            ["en"],
            gpu=False,
            verbose=False,
            model_storage_directory=str(_EASYOCR_MODELS_DIR),
        )
    return _reader


def _normalise(raw: str) -> str:
    """Strip spaces, uppercase."""
    return raw.replace(" ", "").replace("-", "").upper()


def _format_plate(normalised: str) -> str:
    """Return display form with canonical spaces."""
    t = normalised
    if len(t) == 6 and t[:3].isalpha() and t[3:].isdigit():
        return f"{t[:3]} {t[3:]}"          # ABC 123
    if len(t) == 7 and t[:2].isalpha() and t[2:5].isdigit() and t[5:].isalpha():
        return f"{t[:2]} {t[2:5]} {t[5:]}"  # AB 123 CD
    return normalised


def _plate_confidence_factor(text: str) -> float:
    """Returns a multiplier based on whether the text matches a known format."""
    if _OLD_RE.match(text) or _MERCOSUR_RE.match(text):
        return 1.15  # 15 % boost — matches a real Argentine format
    return 0.70      # 30 % penalty — unknown format


@dataclass
class OcrResult:
    plate: str        # Display form: "AB 123 CD"
    text: str         # Normalised:   "AB123CD"
    confidence: float  # Composite score [0, 1]


def extract(crop: np.ndarray, detection_conf: float) -> OcrResult | None:
    """Run OCR on a cropped plate image and return a structured result."""
    reader = _get_reader()
    raw_results = reader.readtext(crop, detail=1, paragraph=False)
    if not raw_results:
        return None

    combined = _normalise("".join(r[1] for r in raw_results))
    if not combined:
        return None

    avg_ocr_conf = float(np.mean([r[2] for r in raw_results]))

    # Composite: detection quality × OCR quality × format match factor.
    confidence = min(detection_conf * avg_ocr_conf * _plate_confidence_factor(combined), 1.0)

    return OcrResult(
        plate=_format_plate(combined),
        text=combined,
        confidence=round(confidence, 3),
    )