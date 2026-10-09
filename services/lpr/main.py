"""LPR microservice — FastAPI entry point.

Usage:
    python main.py [PORT]     # defaults to 8765
"""

import base64
import hmac
import logging
import os
import sys
from contextlib import asynccontextmanager

import cv2
import numpy as np
import uvicorn
from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from recognizer import PlateRecognizer

def _port_from_argv() -> int:
    """El puerto sale del primer argumento, si es que ese argumento es un puerto.

    Mismo arreglo que en el servicio de cámara: con `int(sys.argv[1])` pelado,
    `python main.py --reload` moría con un `ValueError` sin contexto, y el
    módulo no se podía ni importar desde un test, porque pytest deja la ruta
    del test en `sys.argv[1]`.
    """
    if len(sys.argv) > 1:
        try:
            return int(sys.argv[1])
        except ValueError:
            pass
    return 8765


PORT = _port_from_argv()
SHUTDOWN_TOKEN = os.environ.get("PARKIT_SHUTDOWN_TOKEN")

def _force_utf8_stdio(streams) -> None:
    r"""Escribir en UTF-8 pase lo que pase, sin depender del entorno.

    Hoy este servicio imprime ASCII puro y no lo necesita. Está igual porque el
    servicio de cámara se moría en Windows por exactamente esto —un `─` del
    banner contra una consola cp1252, y el proceso no llegaba a arrancar— y la
    única razón por la que el LPR no se caía era esa: que nadie había escrito
    todavía un log con un acento.

    Las variables `PYTHONUTF8` / `PYTHONIOENCODING` que pasa Electron NO
    alcanzan: el binario de PyInstaller arranca el intérprete en modo aislado y
    las ignora. Tiene que ser código. Ver `services/camera/main.py` para la
    explicación completa.
    """
    for stream in streams:
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is None:
            continue
        try:
            reconfigure(encoding="utf-8", errors="replace")
        except (ValueError, OSError):
            pass


_force_utf8_stdio((sys.stdout, sys.stderr))

logging.getLogger("uvicorn.access").setLevel(logging.WARNING)

_recognizer: PlateRecognizer | None = None
_server: uvicorn.Server | None = None


def _require_shutdown_token(token: str | None) -> None:
    if not SHUTDOWN_TOKEN or token is None:
        raise HTTPException(status_code=403, detail="Forbidden")
    if not hmac.compare_digest(token, SHUTDOWN_TOKEN):
        raise HTTPException(status_code=403, detail="Forbidden")


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _recognizer
    _recognizer = PlateRecognizer()
    _recognizer.warmup()  # load ONNX sessions up front so request #1 isn't slow
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
    plate: str                  # display form, e.g. "AB 123 CD"
    text: str                   # normalised, e.g. "AB123CD"
    rawText: str                # OCR output before normalisation
    normalizedText: str         # normalised, e.g. "AB123CD"
    displayPlate: str           # display form, e.g. "AB 123 CD"
    formatValid: bool
    formatType: str             # argentina_old | argentina_mercosur | unknown
    qualityStatus: str          # valid_high | valid_low | invalid_format | low_confidence
    confidence: float           # composite [0, 1]
    bbox: list[int]             # [x1, y1, x2, y2] of the plate in the source image


# Versión del build. Electron la pasa por entorno y la compara al arrancar
# para distinguir un servicio suyo de uno que sobrevivió a una actualización.
#
# EL BUG QUE ESTO ARREGLA
#
# Al arrancar, Electron pregunta por `/health` y si algo responde lo ADOPTA en
# vez de lanzar uno nuevo — pensado para desarrollo, donde uno corre el
# servicio a mano. Pero si un servicio viejo sobrevivía al cierre (pasaba en
# Windows: ver `forceKillTree` en electron/services.ts), la versión NUEVA de la
# app adoptaba al proceso VIEJO y seguía corriendo código viejo sin avisar.
# Encima lo marcaba como adoptado —"no lo cierres al salir"— así que se quedaba
# para siempre reteniendo el puerto y la conexión con la cámara.
BUILD_VERSION = os.environ.get("PARKIT_BUILD_VERSION", "dev")

@app.get("/health")
def health():
    return {"status": "ok", "version": BUILD_VERSION}


@app.post("/shutdown", status_code=202)
def shutdown(x_parkit_shutdown_token: str | None = Header(default=None)):
    _require_shutdown_token(x_parkit_shutdown_token)
    if _server is not None:
        _server.should_exit = True
    return {"status": "shutting down"}


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

    result = _recognizer.recognize(image)
    if result is None:
        raise HTTPException(status_code=404, detail="No readable license plate detected")

    return ProcessResponse(
        plate=result.plate,
        text=result.text,
        rawText=result.raw_text,
        normalizedText=result.text,
        displayPlate=result.plate,
        formatValid=result.format_valid,
        formatType=result.format_type,
        qualityStatus=result.quality_status,
        confidence=result.confidence,
        bbox=list(result.bbox),
    )


if __name__ == "__main__":
    _config = uvicorn.Config(
        app,
        host="127.0.0.1",
        port=PORT,
        log_level="info",
        access_log=False,
        # `timeout_graceful_shutdown`: sin esto, el cierre elegante espera a
        # que TODAS las conexiones abiertas terminen, y una inferencia larga no
        # terminan nunca por su cuenta. Resultado: el servicio se quedaba
        # colgado al cerrar la app, Electron se cansaba a los 12 segundos y
        # mandaba un kill que en Windows no alcanzaba (ver `forceKillTree` en
        # electron/services.ts).
        #
        # 5 segundos alcanzan de sobra para cualquier request real; lo que se
        # corta es la espera por las que nunca iban a cerrarse.
        timeout_graceful_shutdown=5,
    )
    _server = uvicorn.Server(_config)
    _server.run()
