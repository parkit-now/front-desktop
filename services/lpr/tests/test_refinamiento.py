"""La segunda pasada del detector: que rescate la patente mal recortada y que
nunca empeore una lectura que ya estaba bien.

El caso de referencia es real: cámara de 2560x1440, zona de detección de
1843x1254, patente `IAG 574` de ~115 px. La primera pasada ubicó el recuadro en
(914, 210, 1004, 253), cortó "IA", y el OCR leyó `G577` al 55 %.
"""

from dataclasses import dataclass
from types import SimpleNamespace

import numpy as np
import pytest

import recognizer

IMAGEN = (1843, 1254)  # ancho, alto
CORRIDO = (914, 210, 1004, 253)  # lo que devolvió la primera pasada
CORRECTO = (888, 220, 972, 254)  # lo que devuelve la segunda, medido


@dataclass
class _Box:
    x1: int
    y1: int
    x2: int
    y2: int


def _det(box, conf):
    return SimpleNamespace(bounding_box=_Box(*box), confidence=conf)


class _Detector:
    """Responde según el tamaño de la imagen: la completa o el recorte."""

    def __init__(self, completa, recorte):
        self.completa, self.recorte, self.recortes = completa, recorte, []

    def predict(self, img):
        if img.shape[:2] == (IMAGEN[1], IMAGEN[0]):
            return self.completa
        self.recortes.append(img.shape[:2])
        return self.recorte


class _Ocr:
    """Lee según dónde cae el recorte: así el test controla qué texto sale."""

    def __init__(self, lecturas):
        self.lecturas = lecturas  # {(alto, ancho): (texto, confianza)}

    def predict(self, crop):
        texto, conf = self.lecturas.get(crop.shape[:2], ("", 0.0))
        return SimpleNamespace(text=texto, confidence=conf) if texto else None


def _tam(box):
    return (box[3] - box[1], box[2] - box[0])


def _reconocedor(detector, ocr):
    rec = object.__new__(recognizer.PlateRecognizer)
    rec._alpr = SimpleNamespace(detector=detector, ocr=ocr)
    return rec


def _imagen():
    return np.zeros((IMAGEN[1], IMAGEN[0], 3), dtype=np.uint8)


@pytest.fixture(autouse=True)
def refinamiento_prendido(monkeypatch):
    monkeypatch.setattr(recognizer, "REFINE_ENABLED", True)


# ── Geometría ─────────────────────────────────────────────────────────────────


def test_la_ventana_deja_contexto_alrededor_del_recuadro():
    x1, y1, x2, y2 = recognizer._refine_window(CORRIDO, *IMAGEN)
    # Un ancho de patente a cada lado: alcanza para cubrir el tercio que la
    # primera pasada dejó afuera.
    assert x1 <= CORRECTO[0] and x2 >= CORRECTO[2]
    assert y1 <= CORRECTO[1] and y2 >= CORRECTO[3]


def test_la_ventana_no_se_sale_de_la_imagen():
    window = recognizer._refine_window((0, 0, 90, 40), *IMAGEN)
    assert window[0] == 0 and window[1] == 0


def test_sin_ganancia_de_escala_no_hay_segunda_pasada():
    """Si el recorte es casi la imagen entera, el detector la vería igual."""
    assert recognizer._refine_window((100, 100, 700, 300), 1000, 400) is None


def test_el_recuadro_refinado_vuelve_a_coordenadas_de_la_imagen():
    window = (800, 150, 1100, 320)
    local = (CORRECTO[0] - 800, CORRECTO[1] - 150, CORRECTO[2] - 800, CORRECTO[3] - 150)
    box, conf = recognizer._pick_refined(CORRIDO, window, [_det(local, 0.9)])
    assert box == CORRECTO and conf == 0.9


def test_una_patente_vecina_en_el_recorte_no_reemplaza_a_la_original():
    window = (800, 150, 1100, 320)
    vecina = (0, 0, 60, 20)  # en (800, 150): no toca al recuadro original
    assert recognizer._pick_refined(CORRIDO, window, [_det(vecina, 0.99)]) is None


# ── Reconocimiento ────────────────────────────────────────────────────────────


def test_rescata_la_patente_mal_recortada():
    detector = _Detector([_det(CORRIDO, 0.6)], [])
    window = recognizer._refine_window(CORRIDO, *IMAGEN)
    local = tuple(v - o for v, o in zip(CORRECTO, window[:2] * 2))
    detector.recorte = [_det(local, 0.95)]
    ocr = _Ocr({_tam(CORRIDO): ("G577", 0.9), _tam(CORRECTO): ("IAG574", 0.91)})

    r = _reconocedor(detector, ocr).recognize(_imagen())

    assert r.plate == "IAG 574"
    assert r.format_valid
    assert r.bbox == CORRECTO
    assert r.confidence == round(0.95 * 0.91, 3)


def test_nunca_empeora_una_lectura_buena():
    """Si la segunda pasada lee peor, se queda la primera."""
    bueno = (888, 220, 972, 254)
    detector = _Detector([_det(bueno, 0.9)], [])
    window = recognizer._refine_window(bueno, *IMAGEN)
    peor = (40, 30, 100, 50)  # se superpone con el original, pero lee basura
    detector.recorte = [_det(peor, 0.95)]
    peor_abs = (peor[0] + window[0], peor[1] + window[1], peor[2] + window[0], peor[3] + window[1])
    ocr = _Ocr({_tam(bueno): ("IAG574", 0.9), _tam(peor_abs): ("G57", 0.99)})

    r = _reconocedor(detector, ocr).recognize(_imagen())

    assert r.plate == "IAG 574"
    assert r.bbox == bueno


def test_apagado_no_hace_la_segunda_pasada(monkeypatch):
    monkeypatch.setattr(recognizer, "REFINE_ENABLED", False)
    detector = _Detector([_det(CORRIDO, 0.6)], [_det((0, 0, 10, 10), 0.9)])
    ocr = _Ocr({_tam(CORRIDO): ("G577", 0.9)})

    r = _reconocedor(detector, ocr).recognize(_imagen())

    assert r.text == "G577"
    assert detector.recortes == []


def test_sin_patentes_devuelve_none():
    assert _reconocedor(_Detector([], []), _Ocr({})).recognize(_imagen()) is None


@pytest.mark.parametrize(
    "a, b, gana",
    [
        (("G577", False, 0.9), ("IAG574", True, 0.6), "IAG574"),  # formato válido manda
        (("IAG574", True, 0.7), ("IAG574", True, 0.9), "IAG574@0.9"),  # después, confianza
    ],
)
def test_criterio_para_elegir_entre_las_dos_pasadas(a, b, gana):
    def rec(texto, valida, conf):
        return recognizer.Recognition(
            plate=texto, text=texto, raw_text=texto, format_valid=valida,
            format_type="x", quality_status="x", confidence=conf, bbox=(0, 0, 1, 1),
        )

    ganador = recognizer._better(rec(*a), rec(*b))
    esperado_texto, _, esperado_conf = gana.partition("@")
    assert ganador.text == esperado_texto
    if esperado_conf:
        assert ganador.confidence == float(esperado_conf)
