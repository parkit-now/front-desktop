"""El detector de movimiento, y que achicar no cambie lo que decide.

POR QUÉ SE ACHICA

`_to_gray_roi` corre diez veces por segundo. A resolución completa eso era
`cvtColor` + `absdiff` + `mean` sobre ~1,3 Mpx por tick —un ROI típico de
1489×890— o sea unos 40 Mpx/s de trabajo para responder un sí o un no. La PC
de la playa tiene dos núcleos.

POR QUÉ ES SEGURO

El veredicto es `diff.mean() < threshold`: un promedio sobre toda la región.
`INTER_AREA` es exactamente un promedio de bloques, así que promediar sobre la
versión reducida da casi el mismo número. Estos tests lo fijan: si alguien
cambia el factor o la interpolación y el veredicto se corre, se entera acá y
no en la playa.

El recorte que se le manda al LPR NO pasa por esta función: sale del cuadro
original a resolución completa en `main.py`. Acá sólo se decide CUÁNDO mirar.
"""

import cv2
import numpy as np
import pytest

from motion import MotionDetector, roi_crop


def _frame(valor=0, size=(900, 1500)):
    return np.full((size[0], size[1], 3), valor, dtype=np.uint8)


def _con_auto(base, x=200, y=300, ancho=400, alto=250, brillo=200):
    """Un rectángulo claro sobre el fondo: el auto que entra."""
    f = base.copy()
    f[y : y + alto, x : x + ancho] = brillo
    return f


def _detector(threshold=1.5, cooldown=0.0):
    # `warmup_frames=0`: los tests arman el par de cuadros a mano.
    return MotionDetector(threshold=threshold, cooldown=cooldown, warmup_frames=0)


def test_dos_cuadros_iguales_no_son_movimiento():
    d = _detector()
    quieto = _frame(40)
    d.check(quieto)
    disparo, _ = d.check(quieto)
    assert disparo is False


def test_un_auto_que_entra_dispara():
    d = _detector()
    d.check(_frame(40))
    disparo, snapshot = d.check(_con_auto(_frame(40)))
    assert disparo is True
    assert snapshot is not None


def test_el_snapshot_es_el_cuadro_que_disparo():
    """La evidencia tiene que ser EXACTAMENTE lo que se miró, no un cuadro vecino."""
    d = _detector()
    d.check(_frame(40))
    entrando = _con_auto(_frame(40))
    _, snapshot = d.check(entrando)
    assert np.array_equal(snapshot, entrando)


def test_el_snapshot_es_a_resolucion_COMPLETA_aunque_el_diff_sea_reducido():
    """Lo que se achica es la decisión, no la imagen. Si esto se rompe, el LPR
    recibe una patente de un cuarto del tamaño y deja de leerla."""
    d = _detector()
    original = _frame(40)
    d.check(original)
    _, snapshot = d.check(_con_auto(original))
    assert snapshot.shape == original.shape


@pytest.mark.parametrize("brillo", [60, 80, 120, 200, 255])
def test_achicar_decide_lo_mismo_que_el_cuadro_completo(brillo):
    """El corazón del cambio: mismo par de cuadros, mismo veredicto.

    Se compara el `mean()` del diff a resolución completa contra el de la
    versión reducida. La diferencia tiene que ser chica frente al umbral.
    """
    base = _frame(40)
    entrando = _con_auto(base, brillo=brillo)

    completo = cv2.absdiff(
        cv2.cvtColor(base, cv2.COLOR_BGR2GRAY),
        cv2.cvtColor(entrando, cv2.COLOR_BGR2GRAY),
    ).mean()

    d = _detector()
    reducido = cv2.absdiff(d._to_gray_roi(base), d._to_gray_roi(entrando)).mean()

    assert reducido == pytest.approx(completo, abs=0.5)


def test_el_roi_sigue_recortando_despues_de_achicar():
    """Movimiento FUERA del ROI no dispara: es lo que evita los ingresos falsos
    de los autos que pasan por la calle."""
    roi = (0, 0, 400, 400)
    d = MotionDetector(threshold=1.5, cooldown=0.0, roi=roi, warmup_frames=0)
    base = _frame(40)
    d.check(base)
    # El auto aparece lejos del ROI.
    afuera = _con_auto(base, x=1000, y=600, ancho=300, alto=200)
    disparo, _ = d.check(afuera)
    assert disparo is False


def test_un_roi_chico_no_se_achica():
    """Por debajo del mínimo, achicar cuesta más de lo que ahorra y perdería
    sensibilidad."""
    roi = (0, 0, 120, 120)
    d = MotionDetector(threshold=1.5, cooldown=0.0, roi=roi, warmup_frames=0)
    gris = d._to_gray_roi(_frame(40))
    assert gris.shape == (120, 120)


def test_un_roi_grande_si_se_achica():
    d = _detector()
    gris = d._to_gray_roi(_frame(40, size=(900, 1500)))
    assert gris.shape == (900 // 4, 1500 // 4)


def test_el_cooldown_frena_disparos_seguidos():
    d = _detector(cooldown=60.0)
    base = _frame(40)
    d.check(base)
    assert d.check(_con_auto(base))[0] is True
    assert d.check(_con_auto(base, x=900))[0] is False


def test_un_cambio_de_resolucion_no_dispara():
    """Cambiar de cámara no es un auto entrando."""
    d = _detector()
    d.check(_frame(40, size=(900, 1500)))
    disparo, _ = d.check(_frame(200, size=(480, 640)))
    assert disparo is False


def test_roi_crop_fuera_de_cuadro_devuelve_el_cuadro_entero():
    base = _frame(40, size=(100, 100))
    assert roi_crop(base, (500, 500, 600, 600)).shape == base.shape
