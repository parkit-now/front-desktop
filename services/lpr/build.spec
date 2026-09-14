# -*- mode: python ; coding: utf-8 -*-
#
# PyInstaller spec for the LPR microservice (fast-alpr / ONNX stack).
#
# Prerequisites before building:
#   make lpr-download-models    ← populates ~/.cache with the ONNX models
#   make lpr-build              ← runs this spec via PyInstaller
#
# Output: dist/lpr-service  (or dist/lpr-service.exe on Windows)
#
# Offline models: the detector and OCR libraries cache their ONNX files under
# ~/.cache/open-image-models and ~/.cache/fast-plate-ocr. We copy those caches
# into the bundle under models/ so recognizer._seed_offline_cache() can restore
# them on the end-user machine — no internet needed at runtime.

from pathlib import Path

from PyInstaller.utils.hooks import collect_data_files, collect_submodules

_HOME = Path.home()

# ── Data files ──────────────────────────────────────────────────────────────
datas = []
datas += collect_data_files("fast_alpr")
datas += collect_data_files("fast_plate_ocr")
datas += collect_data_files("open_image_models")
datas += collect_data_files("onnxruntime")

# Ship the cached ONNX models, mirroring the layout recognizer.py expects under
# models/<lib>/<model>/...  (build fails loudly if the caches are missing.)
for lib in ("open-image-models", "fast-plate-ocr"):
    cache = _HOME / ".cache" / lib
    if not cache.is_dir():
        raise SystemExit(f"Missing model cache {cache} — run `make lpr-download-models` first.")
    datas += [(str(cache), f"models/{lib}")]

# ── Hidden imports ────────────────────────────────────────────────────────────
hiddenimports = (
    collect_submodules("fast_alpr")
    + collect_submodules("fast_plate_ocr")
    + collect_submodules("open_image_models")
    + collect_submodules("onnxruntime")
    + ["PIL._imaging"]
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
    # Exclude heavy packages we never use at runtime. torch/easyocr are gone
    # from the dependency tree entirely, but excluding defends against
    # transitive re-introduction bloating the bundle.
    excludes=["tkinter", "matplotlib", "notebook", "scipy", "pandas", "torch", "torchvision", "easyocr"],
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
    # UPX-compressed + unsigned onefile binaries are exactly the pattern
    # Windows Defender's heuristics flag most often as a false positive — see
    # services/camera/build.spec for the full note.
    upx=False,
    upx_exclude=[],
    # onefile — Electron just needs a single binary path in extraResources.
    runtime_tmpdir=None,
    console=True,
)
