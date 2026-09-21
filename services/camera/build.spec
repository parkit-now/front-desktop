# -*- mode: python ; coding: utf-8 -*-
#
# PyInstaller spec for the Camera microservice.
#
# Prerequisites before building:
#   make camera-install    ← creates the venv and installs deps
#   make camera-build      ← runs this spec via PyInstaller
#
# Output: dist/camera-service  (or dist/camera-service.exe on Windows)
#
# The resulting binary embeds the Python runtime, OpenCV, httpx and all
# dependencies. Electron only needs the binary path in extraResources.

import glob
import importlib.util
import os

from PyInstaller.utils.hooks import collect_data_files, collect_dynamic_libs, collect_submodules

# ── Data files ────────────────────────────────────────────────────────────────
datas = []
datas += collect_data_files("cv2")
datas += collect_data_files("numpy")
binaries = []
binaries += collect_dynamic_libs("numpy")
binaries += collect_dynamic_libs("cv2")


def _opencv_ffmpeg_libs():
    """El backend FFmpeg de OpenCV: lo que abre las URLs `rtsp://`.

    POR QUÉ ESTÁ A MANO Y NO ALCANZA CON collect_dynamic_libs

    En Windows, `opencv-python-headless` trae `opencv_videoio_ffmpeg*.dll` dentro
    del paquete `cv2/`, y cv2 lo carga con LoadLibrary **en tiempo de ejecución**,
    solo cuando alguien abre una fuente que lo necesita. No figura en la tabla de
    imports de `cv2.pyd`, así que el analizador de dependencias de PyInstaller no
    tiene cómo verlo.

    El síntoma si falta es engañoso: la webcam USB sigue andando (MSMF y DSHOW
    son del sistema) y la cámara IP falla con `isOpened() == False`, sin ningún
    mensaje que apunte a un DLL. O sea, el `.exe` del release se rompe justo en
    lo único que este cambio agrega.

    En Linux/macOS estas libs viven en `opencv_python_headless.libs/`, hermano de
    `cv2/`, y se resuelven por el RPATH del `.so`: acá esta función no encuentra
    nada y no hace daño.
    """
    spec = importlib.util.find_spec("cv2")
    if spec is None or not spec.submodule_search_locations:
        return []
    package_dir = list(spec.submodule_search_locations)[0]
    found = []
    for pattern in ("*videoio_ffmpeg*.dll", "*videoio_ffmpeg*.so*", "*videoio_ffmpeg*.dylib"):
        for path in glob.glob(os.path.join(package_dir, pattern)):
            # Destino "." = raíz del bundle, que es donde cv2 lo busca.
            found.append((path, "."))
    return found


binaries += _opencv_ffmpeg_libs()

# ── Hidden imports ────────────────────────────────────────────────────────────
hiddenimports = (
    collect_submodules("cv2")
    + collect_submodules("numpy")
    + collect_submodules("httpx")
    + [
        "sqlite3",
        "uvicorn.logging",
        "uvicorn.loops",
        "uvicorn.loops.auto",
        "uvicorn.protocols",
        "uvicorn.protocols.http",
        "uvicorn.protocols.http.auto",
        "uvicorn.lifespan",
        "uvicorn.lifespan.on",
    ]
)

# ── Analysis ──────────────────────────────────────────────────────────────────
a = Analysis(
    ["main.py"],
    pathex=["."],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=["tkinter", "matplotlib", "notebook", "scipy", "pandas", "torch", "torchvision"],
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name="camera-service",
    debug=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
)
