"""Un auto que ya conocemos no vuelve a gastar disco ni subida.

Antes la supresión de repetidos vivía sólo en el renderer y actuaba DESPUÉS de
que este servicio ya hubiera escrito el JPEG y creado el evento. Un auto quieto
en la entrada dejaba una imagen cada 6-10 segundos.

La lista de patentes conocidas la manda el renderer y NO sale de la base de
este servicio: las dos derivan, y una fila `pending` zombi dejaba a esa patente
ciega para siempre.
"""

import numpy as np
import pytest

import main


class _StorageFalso:
    """Lo mínimo que `_persist_cluster` le pide a LocalStorage."""

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
    return fake


def _cluster(plate="AB123CD"):
    candidato = {
        "result": {
            "normalizedText": plate,
            "displayPlate": plate,
            "confidence": 0.9,
            "qualityStatus": "valid_high",
            "formatValid": True,
            "formatType": "mercosur",
        },
        "bbox": (100, 100, 358, 233),
        "frame_size": (1131, 762),
        "seen_at": 0.0,
        "frame": np.zeros((762, 1131, 3), dtype=np.uint8),
    }
    return {
        "first_seen": 0.0,
        "last_seen": 0.0,
        "best": candidato,
        "candidates": [candidato],
    }


def test_una_patente_nueva_se_guarda(storage):
    assert main._persist_cluster(_cluster()) is not None
    assert storage.guardados == ["AB123CD"]


def test_una_fila_pending_vieja_en_la_base_NO_bloquea(storage, monkeypatch):
    """La regresión que rompió la detección en producción.

    Había 69 filas `pending` de hasta un mes atrás, que el operador ya había
    resuelto pero cuyo aviso se perdió. Mientras la base era la autoridad, un
    `AB123CD` de agosto dejaba ciega esa patente para siempre.
    """
    # El helper que preguntaba esto a la base ya no existe en `storage.py`, pero
    # se lo devolvemos acá al doble: si alguien lo vuelve a escribir y a
    # cablear, este test se cae en vez de dejar pasar el bug otra vez.
    consultada = []

    def has_pending(normalized_text, exclude_event_id=None):
        consultada.append(normalized_text)
        return True

    storage.has_pending_lpr_event_for_plate = has_pending
    # ...pero el renderer, que es el que manda, dice que no tiene nada.
    _el_renderer_conoce(monkeypatch)

    assert main._persist_cluster(_cluster()) is not None
    assert storage.guardados == ["AB123CD"]
    assert consultada == [], "volvió a preguntarle a la base, que deriva"


def _el_renderer_conoce(monkeypatch, *plates):
    monkeypatch.setattr(main, "_known_plates_value", set(plates))
    monkeypatch.setattr(main, "_known_plates_at", main.time.monotonic())


def test_no_guarda_si_el_renderer_ya_tiene_esa_patente(storage, monkeypatch):
    """Ya sea porque el auto está adentro o porque ya tiene tarjeta abierta."""
    _el_renderer_conoce(monkeypatch, "AB123CD")
    assert main._persist_cluster(_cluster()) is None
    assert storage.guardados == [], "escribió una imagen que nadie va a ver"


def test_una_lista_vencida_no_suprime_nada(storage, monkeypatch):
    """Si el renderer se cayó, se vuelve a guardar de más: es el error seguro.

    Lo contrario —seguir suprimiendo contra una lista congelada— es un auto que
    nunca se registra y nadie entiende por qué.
    """
    monkeypatch.setattr(main, "_known_plates_value", {"AB123CD"})
    monkeypatch.setattr(
        main, "_known_plates_at", main.time.monotonic() - main._KNOWN_PLATES_TTL - 1
    )
    assert main._persist_cluster(_cluster()) is not None
    assert storage.guardados == ["AB123CD"]


def test_un_auto_quieto_deja_una_sola_imagen(storage, monkeypatch):
    """El caso que disparó esto: 6 imágenes en 42 segundos.

    La primera pasa; el renderer la ve y devuelve la patente en su lista, y a
    partir de ahí no se guarda nada más.
    """
    for i in range(6):
        main._persist_cluster(_cluster("NVZ087"))
        if i == 0:
            _el_renderer_conoce(monkeypatch, "NVZ087")
    assert storage.guardados == ["NVZ087"]


def test_el_cooldown_cubre_el_hueco_hasta_que_contesta_el_renderer(storage):
    """Entre que se guarda y el renderer avisa pasan ~12 s.

    En ese hueco la única defensa es el cooldown en memoria. En memoria, y no
    leído de la base, para que no pueda quedar desactualizado.
    """
    assert main._persist_cluster(_cluster("NVZ087")) is not None
    # Sin que el renderer haya contestado todavía:
    assert main._persist_cluster(_cluster("NVZ087")) is None
    assert storage.guardados == ["NVZ087"]
    assert main.COOLDOWN >= 12, "no alcanza para cubrir el viaje al renderer"


# ── La lista de patentes conocidas ────────────────────────────────────────────


def test_normaliza_igual_que_el_renderer():
    """Si las dos reglas divergen, la supresión no matchea nunca y no se nota."""
    main.set_known_plates({"plates": ["ab 123 cd", "AE-622-RW", "nvz_087", "  ", None]})
    assert main._known_plates() == {"AB123CD", "AE622RW", "NVZ087"}


def test_rechaza_un_payload_que_no_es_lista():
    with pytest.raises(main.HTTPException) as exc:
        main.set_known_plates({"plates": "AB123CD"})
    assert exc.value.status_code == 400


def test_la_lista_vence(monkeypatch):
    """Si el renderer se cae, se vuelve a guardar de más — no a suprimir siempre.

    Quedarse con una lista congelada sería un auto que nunca se registra y
    nadie entiende por qué.
    """
    main.set_known_plates({"plates": ["AB123CD"]})
    assert main._known_plates() == {"AB123CD"}
    monkeypatch.setattr(
        main, "_known_plates_at", main.time.monotonic() - main._KNOWN_PLATES_TTL - 1
    )
    assert main._known_plates() == set()


def test_default_plate_cooldown_cubre_el_viaje_del_renderer():
    assert main.COOLDOWN == 60.0
    assert main.COOLDOWN >= 12
