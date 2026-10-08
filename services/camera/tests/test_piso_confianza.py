"""El piso de confianza: lo que ni en su mejor momento se leyó, no se muestra.

EL PROBLEMA QUE RESUELVE

Hasta ahora NO había ningún piso. `MIN_CONFIDENCE` sólo escribía la etiqueta
`low_confidence` y la detección se publicaba igual, así que al operador le
llegaba toda lectura que devolviera el LPR — incluso con 17% de confianza.
En producción eso dio 285 descartes a mano contra 89 registros, y de las 158
lecturas por debajo de 0,60, **147 terminaron descartadas** (93%).

POR QUÉ EL PISO VA EN EL CLUSTER Y NO EN CADA LECTURA

El grupo junta varias miradas al mismo auto mientras se acerca, y las primeras
son malas casi siempre: lejos, en diagonal, con la patente chica. Filtrar
lectura por lectura tiraría el auto antes de llegar a la mirada buena. El
grupo pregunta lo correcto: "de todo lo que vimos de este auto, ¿algo sirvió?".
"""

import numpy as np
import pytest

import main


class _StorageFalso:
    def __init__(self):
        self.guardados = []

    def save(self, frame, camera_id, location, lpr_result, event_id, bbox):
        self.guardados.append(lpr_result["plate"])
        return "capture-1"

    def upsert_lpr_event(self, event):
        return event


@pytest.fixture
def storage(monkeypatch):
    fake = _StorageFalso()
    monkeypatch.setattr(main, "_storage", fake)
    monkeypatch.setattr(main, "_last_saved_by_plate", {})
    monkeypatch.setattr(main, "_known_plates_value", set())
    monkeypatch.setattr(main, "_known_plates_at", 0.0)
    monkeypatch.setattr(main, "_testing_mode_at", None)
    return fake


def _candidato(confianza, plate="AB123CD"):
    return {
        "result": {
            "normalizedText": plate,
            "displayPlate": plate,
            "confidence": confianza,
            "qualityStatus": "valid_high" if confianza >= 0.85 else "low_confidence",
            "formatValid": True,
            "formatType": "mercosur",
        },
        "bbox": (100, 100, 358, 233),
        "frame_size": (1131, 762),
        "seen_at": 0.0,
        "frame": np.zeros((762, 1131, 3), dtype=np.uint8),
    }


def _cluster(mejor_confianza, otras=()):
    mejor = _candidato(mejor_confianza)
    candidatos = [_candidato(c) for c in otras] + [mejor]
    return {
        "first_seen": 0.0,
        "last_seen": 0.0,
        "best": mejor,
        "candidates": candidatos,
    }


def test_un_grupo_bueno_se_publica(storage):
    assert main._persist_cluster(_cluster(0.92)) is not None
    assert storage.guardados == ["AB123CD"]


def test_un_grupo_por_debajo_del_piso_no_se_publica_ni_escribe_imagen(storage):
    # Ni evento ni JPEG: el gasto de disco también se evita, no sólo la tarjeta.
    assert main._persist_cluster(_cluster(0.41)) is None
    assert storage.guardados == []


def test_el_piso_mira_al_MEJOR_candidato_no_al_peor(storage):
    """Un auto que se vio mal al principio y bien al final SÍ se publica.

    Es el caso normal: el auto entra de lejos, se lee mal, se acerca y se lee
    bien. Si el piso mirase cualquier lectura, perderíamos todos los ingresos.
    """
    assert main._persist_cluster(_cluster(0.91, otras=(0.22, 0.38))) is not None
    assert storage.guardados == ["AB123CD"]


def test_justo_en_el_piso_pasa(storage):
    assert main._persist_cluster(_cluster(main.DISCARD_BELOW)) is not None


def test_apenas_por_debajo_del_piso_no_pasa(storage):
    assert main._persist_cluster(_cluster(main.DISCARD_BELOW - 0.01)) is None


def test_el_piso_es_configurable_en_caliente(storage, monkeypatch):
    """El panel lo ajusta sin reiniciar: una playa oscura puede necesitar otro."""
    monkeypatch.setattr(main, "DISCARD_BELOW", 0.0)
    assert main._persist_cluster(_cluster(0.05)) is not None
