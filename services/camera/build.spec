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

from PyInstaller.utils.hooks import collect_data_files, collect_dynamic_libs, collect_submodules

# ── Data files ────────────────────────────────────────────────────────────────
datas = []
datas += collect_data_files("cv2")
datas += collect_data_files("numpy")
binaries = []
binaries += collect_dynamic_libs("numpy")

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
    # UPX-compressed + unsigned onefile binaries are exactly the pattern
    # Windows Defender's heuristics flag most often as a false positive — it
    # quarantines/deletes the exe before Electron can spawn it, which surfaces
    # as a connection-refused error in the renderer, not a visible AV alert.
    # Disabling UPX trades a larger binary for far fewer false positives; the
    # right long-term fix is code signing, tracked separately.
    upx=False,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
)
