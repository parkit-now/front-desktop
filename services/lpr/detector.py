"""YOLO-based license plate detection."""

import sys
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np
from ultralytics import YOLO

# Resolve the models dir whether running from source or a PyInstaller bundle.
_BASE = Path(sys._MEIPASS) if getattr(sys, "frozen", False) else Path(__file__).parent
MODELS_DIR = _BASE / "models"
MODEL_FILE = MODELS_DIR / "plate_detector.pt"

# Public HuggingFace checkpoint — downloaded once via lpr-download-models.
_HF_MODEL = "keremberke/yolov8n-license-plate-detection"


@dataclass
class Detection:
    crop: np.ndarray           # BGR plate crop, ready for OCR
    confidence: float          # YOLO detection score [0, 1]
    bbox: tuple[int, int, int, int]  # x1, y1, x2, y2 in source image


class PlateDetector:
    """Wraps YOLOv8 for license plate localisation.

    On first instantiation the model is downloaded from HuggingFace and
    cached to ``models/plate_detector.pt`` so subsequent starts are offline.
    """

    def __init__(self, model_path: Path | None = None) -> None:
        target = model_path or MODEL_FILE
        if not target.exists():
            MODELS_DIR.mkdir(parents=True, exist_ok=True)
            tmp = YOLO(_HF_MODEL)
            tmp.save(str(target))
        self._model = YOLO(str(target))

    def detect(self, image: np.ndarray) -> list[Detection]:
        """Return plate detections sorted by confidence (best first)."""
        results = self._model.predict(image, verbose=False)[0]
        detections: list[Detection] = []
        for box in results.boxes:
            x1, y1, x2, y2 = map(int, box.xyxy[0].tolist())
            conf = float(box.conf[0])
            crop = image[y1:y2, x1:x2]
            if crop.size > 0:
                detections.append(Detection(crop=crop, confidence=conf, bbox=(x1, y1, x2, y2)))
        return sorted(detections, key=lambda d: d.confidence, reverse=True)