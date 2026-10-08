"""La foto completa del ROI y el recuadro de la patente en fracciones."""

import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient

import main


# ── El bbox normalizado ───────────────────────────────────────────────────────


def test_convierte_pixeles_a_fracciones():
    # Frame 1000x500, patente en (100,50)-(300,150).
    assert main._normalized_bbox((100, 50, 300, 150), (500, 1000, 3)) == {
        "x": 0.1,
        "y": 0.1,
        "w": 0.2,
        "h": 0.2,
    }


def test_es_relativo_a_la_imagen_no_al_roi():
    """La MISMA patente en dos frames de distinto tamaño da lo mismo.

    Es lo que hace que reescalar antes de subir no rompa nada, y que
    recalibrar el ROI no corrompa los eventos viejos.
    """
    chico = main._normalized_bbox((100, 50, 300, 150), (500, 1000, 3))
    grande = main._normalized_bbox((200, 100, 600, 300), (1000, 2000, 3))
    assert chico == grande


def test_clampea_lo_que_se_sale_del_cuadro():
    b = main._normalized_bbox((-50, -50, 1200, 700), (500, 1000, 3))
    assert b["x"] == 0 and b["y"] == 0
    assert b["x"] + b["w"] <= 1
    assert b["y"] + b["h"] <= 1


@pytest.mark.parametrize(
    "bbox, shape",
    [
        (None, (500, 1000, 3)),
        ((100, 50, 300, 150), None),
        ((100, 50, 100, 150), (500, 1000, 3)),  # ancho cero
        ((100, 50, 300, 50), (500, 1000, 3)),   # alto cero
        ((100, 50, 300, 150), (0, 0, 3)),       # frame vacío
    ],
)
def test_una_caja_degenerada_no_devuelve_nada(bbox, shape):
    """El None significa «no recortes», que es el comportamiento seguro."""
    assert main._normalized_bbox(bbox, shape) is None


# ── El endpoint ───────────────────────────────────────────────────────────────


class _StorageFalso:
    def __init__(self, path):
        self.path = path

    def get(self, capture_id):
        return {"path": self.path, "bbox": "100,50,300,150"} if capture_id == "ok" else None


@pytest.fixture
def cliente(tmp_path, monkeypatch):
    jpg = tmp_path / "captura.jpg"
    cv2.imwrite(str(jpg), np.full((720, 1280, 3), 128, dtype=np.uint8))
    monkeypatch.setattr(main, "_storage", _StorageFalso(str(jpg)))
    # El TestClient dispara el lifespan, que abriría la cámara. Se evita
    # llamando directo a las rutas con una app pelada.
    from fastapi import FastAPI

    app = FastAPI()
    app.add_api_route("/capture/{capture_id}/image.jpg", main.capture_full_image)
    return TestClient(app), jpg


def test_sin_parametros_devuelve_el_archivo_tal_cual(cliente):
    client, jpg = cliente
    res = client.get("/capture/ok/image.jpg")
    assert res.status_code == 200
    assert res.headers["content-type"] == "image/jpeg"
    assert res.content == jpg.read_bytes(), "recomprimió algo que no hacía falta"


def test_con_parametros_achica_y_pesa_menos(cliente):
    client, jpg = cliente
    res = client.get("/capture/ok/image.jpg?maxWidth=640&quality=55")
    assert res.status_code == 200
    img = cv2.imdecode(np.frombuffer(res.content, np.uint8), cv2.IMREAD_COLOR)
    assert img.shape[1] == 640
    assert len(res.content) < len(jpg.read_bytes())


def test_nunca_agranda(cliente):
    client, _ = cliente
    res = client.get("/capture/ok/image.jpg?maxWidth=4000&quality=85")
    img = cv2.imdecode(np.frombuffer(res.content, np.uint8), cv2.IMREAD_COLOR)
    assert img.shape[1] == 1280


def test_captura_inexistente_da_404(cliente):
    client, _ = cliente
    assert client.get("/capture/nope/image.jpg").status_code == 404


@pytest.mark.parametrize("query", ["maxWidth=10", "maxWidth=99999", "quality=0", "quality=200"])
def test_parametros_fuera_de_rango(cliente, query):
    client, _ = cliente
    assert client.get(f"/capture/ok/image.jpg?{query}").status_code == 400


def test_no_dibuja_el_recuadro(cliente):
    """Estos bytes van al bucket: un recuadro quemado descuadraría el recorte."""
    client, _ = cliente
    res = client.get("/capture/ok/image.jpg?maxWidth=640&quality=90")
    img = cv2.imdecode(np.frombuffer(res.content, np.uint8), cv2.IMREAD_COLOR)
    # La imagen de origen es gris uniforme. Si se dibujara el recuadro verde
    # habría píxeles con verde dominante.
    b, g, r = img[:, :, 0].astype(int), img[:, :, 1].astype(int), img[:, :, 2].astype(int)
    assert not ((g - b > 40) & (g - r > 40)).any()


def test_el_preview_del_editor_de_ROI_va_sin_achicar():
    """El ROI se dibuja contra el cuadro que llega por `/stream/mjpeg`.

    `RoiEditor.tsx` convierte lo arrastrado a píxeles con el `naturalWidth` del
    `<img>`, y el servicio aplica ese ROI sobre el cuadro ORIGINAL. Si las dos
    resoluciones difieren, la zona marcada cubre otra cosa.

    Ya pasó una vez: achicar el preview a 960 px para ahorrar CPU hizo que un
    ROI dibujado cubriera un tercio de lo elegido. Por eso el editor pide
    `maxWidth=0`, y por eso `0` tiene que significar "no toques el cuadro".
    """
    import numpy as np

    import main

    frame = np.zeros((1440, 2560, 3), dtype=np.uint8)
    assert main._downscale_for_stream(frame, 0).shape == frame.shape


def test_el_preview_normal_si_se_achica():
    import numpy as np

    import main

    frame = np.zeros((1440, 2560, 3), dtype=np.uint8)
    salida = main._downscale_for_stream(frame, 960)
    assert salida.shape[1] == 960
    # Mantiene la proporción: si no, el ROI se deformaría.
    assert salida.shape[0] == 540


def test_un_cuadro_mas_chico_que_el_tope_no_se_toca():
    import numpy as np

    import main

    frame = np.zeros((360, 640, 3), dtype=np.uint8)
    assert main._downscale_for_stream(frame, 960).shape == frame.shape
