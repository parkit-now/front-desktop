# -*- mode: python ; coding: utf-8 -*-
#
# PyInstaller spec for the LPR microservice.
#
# Prerequisites before building:
#   make lpr-download-models    ← populates models/ with YOLO + EasyOCR weights
#   make lpr-build              ← runs this spec via PyInstaller
#
# Output: dist/lpr-service  (or dist/lpr-service.exe on Windows)

from PyInstaller.utils.hooks import collect_data_files, collect_submodules

# ── Data files ──────────────────────────────────────────────────────────────
datas = []
datas += collect_data_files("ultralytics")
datas += collect_data_files("easyocr")
datas += [("models/", "models/")]   # YOLO weights + EasyOCR models

# ── Hidden imports ────────────────────────────────────────────────────────────
hiddenimports = (
    collect_submodules("ultralytics")
    + collect_submodules("easyocr")
    + [
        "PIL._imaging",
        "pkg_resources.py2_compat",
    ]
)

# ── Analysis ──────────────────────────────────────────────────────────────────
a = Analysis(
    ["main.py"],
    pathex=["."],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    # Exclude heavy packages we never use at runtime.
    excludes=["tkinter", "matplotlib", "notebook", "scipy", "pandas"],
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
    name="lpr-service",
    debug=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    # onefile — Electron just needs a single binary path in extraResources.
    runtime_tmpdir=None,
    console=True,
)