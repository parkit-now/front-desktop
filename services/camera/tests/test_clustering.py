"""Que una pasada de un auto deje UNA tarjeta, y dos autos dejen DOS.

Los números de los casos "reales" salen de detecciones medidas contra una
Hikvision, no son inventados. Si alguien recalibra los umbrales, estos tests
son los que dicen si la recalibración sigue separando los casos que importan.
"""

import numpy as np
import pytest

import main


# ── Los dos casos reales que tienen que quedar separados ──────────────────────
#
# Frame analizado: el recorte al ROI, 1131x762.
FRAME = (1131, 762)

# Mismo auto, dos lecturas a 3,04 s. El OCR leyó distinto porque estaba en
# movimiento. Tienen que UNIRSE.
MISMO_A = ("AB174CU", (195, 410, 453, 543))
MISMO_B = ("AB123CD", (259, 578, 516, 683))

# Autos distintos, también a ~3 s y con las cajas MUY cerca (0,042 de la
# diagonal). No tienen que unirse. Este es el par que el criterio viejo —un
# `or` entre texto y posición— fusionaba, perdiendo una patente entera.
DISTINTO_A = ("AH000BO", (234, 387, 519, 520))
DISTINTO_B = ("AB174CU", (195, 410, 453, 543))


def _candidato(plate, bbox, conf=0.8, status="valid_high", frame=FRAME):
    return {
        "result": {
            "normalizedText": plate,
            "confidence": conf,
            "qualityStatus": status,
        },
        "bbox": bbox,
        "frame_size": frame,
        "seen_at": 0.0,
        "frame": None,
    }


# ── Similitud de texto ────────────────────────────────────────────────────────


def test_una_letra_alcanza_sin_mirar_posicion():
    assert main._plates_similar("IAG574", "IOG574", max_distance=1)


def test_limite_escalado_por_longitud():
    # Mercosur (7): tolera 3. Es el caso real.
    assert main._plates_similar("AB174CU", "AB123CD", max_distance=3)
    assert main._levenshtein("AB174CU", "AB123CD") == 3
    # Vieja (6): la misma distancia 3 NO alcanza, porque colisiona 13 veces más.
    assert not main._plates_similar("ABC123", "ABD145", max_distance=3)
    assert main._levenshtein("ABC123", "ABD145") == 3
    # Pero a distancia 2 sí.
    assert main._plates_similar("ABC123", "ABD125", max_distance=3)


def test_fragmentos_cortos_vuelven_al_limite_de_uno():
    # Menos de 6 caracteres es una lectura parcial: relajar ahí es apostar.
    assert not main._plates_similar("AB12", "AB34", max_distance=3)
    assert main._plates_similar("AB12", "AB13", max_distance=3)


def test_el_corto_por_longitud_usa_el_limite_pedido():
    # Con la constante vieja (un 1 fijo) esto se descartaba sin evaluar la
    # distancia, porque las longitudes difieren en 2. Con el límite pedido de 3
    # y ambas de 7 o más, se evalúa y da.
    assert main._plates_similar("AB123CDEF", "AB123CD", max_distance=3)
    assert main._levenshtein("AB123CDEF", "AB123CD") == 2


def test_patentes_sin_relacion_no_se_parecen():
    assert not main._plates_similar("IAG574", "GIL322", max_distance=3)
    assert not main._plates_similar("AH000BO", "AB174CU", max_distance=3)


# ── Posición ──────────────────────────────────────────────────────────────────


def test_posicion_acepta_el_auto_en_movimiento():
    assert main._bbox_close(MISMO_A[1], MISMO_B[1], FRAME, 0.15)


# AE622RW / AF692RK: dos autos distintos cuyas patentes están a levenshtein 3,
# o sea que PASAN el filtro de texto. Es el contraejemplo más cercano que hay
# en los datos medidos, y es contra el que está calibrado el 0,15: quedan a
# 0,189 de la diagonal. El margen a cada lado es de ~25 %, así que si alguien
# toca MOVE_MAX_RATIO, este test y el de más arriba son los que avisan.
FALSO_A = (472, 341, 940, 572)
FALSO_B = (26, 423, 879, 719)
FALSO_FRAME = (1280, 720)


def test_posicion_rechaza_el_falso_mas_cercano():
    assert main._levenshtein("AE622RW", "AF692RK") == 3
    assert main._plates_similar("AE622RW", "AF692RK", max_distance=3)
    assert not main._bbox_close(FALSO_A, FALSO_B, FALSO_FRAME, 0.15)


def test_posicion_sin_frame_no_decide():
    assert not main._bbox_close(MISMO_A[1], MISMO_B[1], None, 0.15)


def test_la_escala_es_la_diagonal_y_no_el_tamano_de_la_patente():
    """Con la escala vieja el orden se invertía y ningún umbral servía."""
    def escala_patente(a, b):
        ax, ay = (a[0] + a[2]) / 2, (a[1] + a[3]) / 2
        bx, by = (b[0] + b[2]) / 2, (b[1] + b[3]) / 2
        s = max(a[2] - a[0], a[3] - a[1], b[2] - b[0], b[3] - b[1], 1)
        return ((ax - bx) ** 2 + (ay - by) ** 2) ** 0.5 / s

    def escala_diagonal(a, b, frame):
        ax, ay = (a[0] + a[2]) / 2, (a[1] + a[3]) / 2
        bx, by = (b[0] + b[2]) / 2, (b[1] + b[3]) / 2
        d = (frame[0] ** 2 + frame[1] ** 2) ** 0.5
        return ((ax - bx) ** 2 + (ay - by) ** 2) ** 0.5 / d

    # Escala vieja: el par BUENO "parece" más lejos que el falso. Invertido, y
    # por eso ningún umbral sobre esa métrica podía separarlos.
    bueno_viejo = escala_patente(MISMO_A[1], MISMO_B[1])
    falso_viejo = escala_patente(FALSO_A, FALSO_B)
    assert round(bueno_viejo, 3) == 0.646
    assert round(falso_viejo, 3) == 0.326
    assert bueno_viejo > falso_viejo, "la escala vieja invertía el orden"

    # Escala nueva: el bueno queda más cerca que el falso, que es lo correcto,
    # y el 0,15 cae justo entre los dos.
    bueno_nuevo = escala_diagonal(MISMO_A[1], MISMO_B[1], FRAME)
    falso_nuevo = escala_diagonal(FALSO_A, FALSO_B, FALSO_FRAME)
    assert round(bueno_nuevo, 3) == 0.122
    assert round(falso_nuevo, 3) == 0.189
    assert bueno_nuevo < main.MOVE_MAX_RATIO < falso_nuevo


# ── El criterio combinado ─────────────────────────────────────────────────────


def _cluster_de(candidato, first_seen=0.0):
    return {
        "first_seen": first_seen,
        "last_seen": first_seen,
        "best": candidato,
        "candidates": [candidato],
    }


def test_une_el_mismo_auto():
    cluster = _cluster_de(_candidato(*MISMO_A))
    assert main._cluster_matches(cluster, _candidato(*MISMO_B), 3.04) is not None


def test_NO_une_dos_autos_distintos_aunque_esten_pegados():
    """La regresión del `or`.

    Estas dos cajas están a 0,042 de la diagonal: pegadísimas. Con el criterio
    viejo se fusionaban y se perdía una patente. El texto tiene que vetar.
    """
    cluster = _cluster_de(_candidato(*DISTINTO_A))
    assert main._cluster_matches(cluster, _candidato(*DISTINTO_B), 3.0) is None


def test_fuera_de_la_ventana_no_une():
    cluster = _cluster_de(_candidato(*MISMO_A))
    lejos = main.CLUSTER_WINDOW + 1
    assert main._cluster_matches(cluster, _candidato(*MISMO_B), lejos) is None


def test_cambio_de_camara_a_mitad_del_cluster_no_une():
    cluster = _cluster_de(_candidato(*MISMO_A))
    otro = _candidato(*MISMO_B, frame=(1920, 1080))
    assert main._cluster_matches(cluster, otro, 3.04) is None


def test_el_ancla_es_el_ultimo_candidato_no_el_mejor():
    """Un auto que avanza se aleja: contra el primero ya no daría."""
    primero = _candidato("AB174CU", (100, 100, 358, 233), conf=0.95)
    segundo = _candidato("AB174CU", (180, 260, 438, 393), conf=0.60)
    cluster = _cluster_de(primero)
    cluster["candidates"].append(segundo)
    # `best` sigue siendo el primero (mejor confianza), pero el ancla es el
    # último. Una tercera lectura cerca del segundo tiene que entrar.
    assert cluster["best"] is primero
    tercero = _candidato("AB123CD", (260, 420, 518, 553))
    assert main._cluster_matches(cluster, tercero, 3.0) is not None
    # Y contra el primero, que es lo que hacía antes, no habría entrado.
    solo_primero = _cluster_de(primero)
    assert main._cluster_matches(solo_primero, tercero, 3.0) is None


# ── Acumulación ───────────────────────────────────────────────────────────────


def _frame(size=FRAME):
    return np.zeros((size[1], size[0], 3), dtype=np.uint8)


def _agregar(plate, bbox, now, conf=0.8, frame=None):
    main._add_cluster_candidate(
        {"normalizedText": plate, "confidence": conf, "qualityStatus": "valid_high",
         "bbox": list(bbox)},
        frame if frame is not None else _frame(),
        now,
    )


def test_una_pasada_deja_un_solo_cluster_con_la_mejor_lectura():
    _agregar(*MISMO_A, now=0.0, conf=0.68)
    _agregar(*MISMO_B, now=3.04, conf=0.83)
    assert len(main._clusters) == 1
    cluster = main._clusters[0]
    assert len(cluster["candidates"]) == 2
    assert cluster["best"]["result"]["normalizedText"] == "AB123CD"
    assert cluster["best"]["result"]["confidence"] == 0.83


def test_dos_autos_distintos_dejan_dos_clusters():
    _agregar(*DISTINTO_A, now=0.0)
    _agregar(*DISTINTO_B, now=3.0)
    assert len(main._clusters) == 2


def test_elige_el_cluster_mas_cercano_no_el_primero():
    """Con dos clusters abiertos, gana el más parecido, no el más viejo.

    El orden de `_clusters` es de inserción. Antes era first-match-wins, o sea
    una lotería en cuanto hay más de un cluster vivo — que con el settle
    arreglado pasa seguido.
    """
    # Cluster 0: lejos. Cluster 1: cerca de donde va a caer el candidato.
    _agregar("AB123CD", (700, 500, 958, 633), now=0.0)
    _agregar("AB174CU", (100, 100, 358, 233), now=0.1)
    assert len(main._clusters) == 2

    # Este candidato matchea con LOS DOS: con el 0 por texto idéntico, y con el
    # 1 por texto parecido + posición. Tiene que quedarse en el 1, que está
    # mucho más cerca.
    _agregar("AB123CD", (140, 140, 398, 273), now=0.2)
    assert len(main._clusters[1]["candidates"]) == 2, "se lo quedó el primero"
    assert len(main._clusters[0]["candidates"]) == 1


def test_sin_bbox_no_entra():
    main._add_cluster_candidate(
        {"normalizedText": "AB123CD", "confidence": 0.9, "bbox": None},
        _frame(),
        0.0,
    )
    assert main._clusters == []


# ── El bug de fondo: el cluster se cerraba antes de poder agrupar ─────────────


def test_el_cluster_sobrevive_hasta_el_siguiente_analisis(monkeypatch):
    """Con settle 3,5 y análisis cada 3,0 s, el segundo candidato llega a tiempo."""
    monkeypatch.setattr(main, "CLUSTER_SETTLE", 3.5)
    monkeypatch.setattr(main, "CLUSTER_WINDOW", 6.5)
    _agregar(*MISMO_A, now=0.0)
    main._flush_settled_clusters(3.0)
    assert len(main._clusters) == 1, "se cerró antes de que llegara la segunda lectura"


def test_con_el_settle_viejo_el_cluster_ya_no_estaba(monkeypatch):
    """La foto del bug: settle 1,2 < cooldown 3,0 => agrupar era imposible."""
    monkeypatch.setattr(main, "CLUSTER_SETTLE", 1.2)
    monkeypatch.setattr(main, "CLUSTER_WINDOW", 5.0)
    _agregar(*MISMO_A, now=0.0)
    main._flush_settled_clusters(3.0)
    assert main._clusters == []


@pytest.mark.parametrize(
    "cooldown, settle, window, esperado",
    [
        (3.0, 1.2, 5.0, (3.5, 6.5)),      # los defaults viejos
        (1.5, 1.2, 5.0, (2.0, 5.0)),      # los nuevos
        (1.5, 10.0, 30.0, (10.0, 30.0)),  # ya coherentes: no se tocan
    ],
)
def test_timing_coherente(cooldown, settle, window, esperado):
    assert main._coherent_cluster_timing(cooldown, settle, window) == esperado


def test_la_ventana_siempre_deja_lugar_a_un_analisis_mas():
    for cooldown in (0.5, 1.5, 3.0, 10.0, 60.0):
        settle, window = main._coherent_cluster_timing(cooldown, 0.1, 0.5)
        assert settle >= cooldown, "el cluster se cerraría antes del próximo análisis"
        assert window >= settle + cooldown


def test_los_pisos_entran_en_el_rango_que_declara_el_panel():
    """Si el piso excede el máximo, el panel muestra un valor fuera de su rango."""
    max_cooldown = main._TUNABLES["motionCooldown"][2]
    settle, window = main._coherent_cluster_timing(max_cooldown, 0.1, 0.5)
    assert settle <= main._TUNABLES["clusterSettle"][2]
    assert window <= main._TUNABLES["clusterWindow"][2]


# ── Varios ────────────────────────────────────────────────────────────────────


def test_el_puerto_ignora_un_argumento_que_no_es_puerto(monkeypatch):
    monkeypatch.setattr(main.sys, "argv", ["main.py", "--reload"])
    assert main._port_from_argv() == 8766
    monkeypatch.setattr(main.sys, "argv", ["main.py", "9000"])
    assert main._port_from_argv() == 9000


def test_el_snapshot_guarda_el_tamano_del_cuadro():
    """Sin esto el bbox no se puede normalizar después para recalibrar."""
    _agregar(*MISMO_A, now=0.0)
    snap = main._candidate_snapshot(main._clusters[0]["candidates"][0])
    assert snap["frameSize"] == [FRAME[0], FRAME[1]]
