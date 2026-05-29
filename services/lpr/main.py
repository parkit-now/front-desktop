"""LPR microservice — FastAPI entry point.

Usage:
    python main.py [PORT]     # defaults to 8765
"""

import base64
import sys
from contextlib import asynccontextmanager

import cv2
import numpy as np
import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from detector import PlateDetector
from ocr import extract as ocr_extract

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8765

_detector: PlateDetector | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _detector
    _detector = PlateDetector()
    yield


app = FastAPI(title="LPR Service", lifespan=lifespan)

# Allow Electron renderer (and curl during dev) to call without CORS issues.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


class ProcessRequest(BaseModel):
    image: str  # base64-encoded JPG or PNG (no data-URI prefix)


class ProcessResponse(BaseModel):
    plate: str        # display form, e.g. "AB 123 CD"
    text: str         # normalised, e.g. "AB123CD"
    confidence: float  # composite [0, 1]


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/process", response_model=ProcessResponse)
def process_image(req: ProcessRequest):
    # Decode base64 → OpenCV image
    try:
        # Strip data-URI prefix if the client accidentally included it.
        b64 = req.image.split(",")[-1]
        img_bytes = base64.b64decode(b64)
        arr = np.frombuffer(img_bytes, np.uint8)
        image = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    except Exception:
        raise HTTPException(status_code=422, detail="Invalid image data")

    if image is None:
        raise HTTPException(status_code=422, detail="Could not decode image")

    detections = _detector.detect(image)
    if not detections:
        raise HTTPException(status_code=404, detail="No license plate detected")

    # Try the top-3 detections; return the first successful OCR.
    for detection in detections[:3]:
        result = ocr_extract(detection.crop, detection.confidence)
        if result is not None:
            return ProcessResponse(
                plate=result.plate,
                text=result.text,
                confidence=result.confidence,
            )

    raise HTTPException(status_code=404, detail="Could not extract text from plate")


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=PORT, log_level="info")