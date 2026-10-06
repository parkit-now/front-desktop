"""Infraestructura mínima para testear el servicio de cámara.

`main.py` se puede importar sin cámara ni servicio de LPR: `CameraCapture`,
`LocalStorage` y el executor se crean recién en `lifespan`. Lo único que lo
impedía era el parseo del puerto desde `sys.argv`, que bajo pytest recibe una
ruta de test — arreglado en `_port_from_argv`.
"""

import pathlib
import sys

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

import main  # noqa: E402


@pytest.fixture(autouse=True)
def clusters_limpios():
    """Los clusters son estado de módulo: sin esto los tests se contaminan."""
    main._clusters.clear()
    yield
    main._clusters.clear()


@pytest.fixture(autouse=True)
def sin_modo_prueba():
    """`set_known_plates` lo deja prendido: que no se filtre al test siguiente."""
    main._testing_mode_at = None
    main._ignored_plate_snapshot = {"tenantId": None, "ignoredPlates": []}
    yield
    main._testing_mode_at = None
    main._ignored_plate_snapshot = {"tenantId": None, "ignoredPlates": []}
