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


def test_la_zona_que_se_analiza_es_LA_MISMA_que_se_le_manda_al_LPR():
    """El invariante que se rompió una vez y hay que dejar clavado.

    Son tres cosas que tienen que coincidir y viven en lugares distintos:

      1. La zona que el usuario dibuja en el panel (`RoiEditor.tsx`), en
         píxeles del cuadro que le llega por `/stream/mjpeg`.
      2. La zona sobre la que se busca movimiento (`_to_gray_roi`).
      3. La zona que se recorta y se le manda al reconocedor (`main.py`).

    Si cualquiera queda en otra escala, la detección empeora **en silencio**:
    no falla, tarda. Ya pasó al achicar el preview para ahorrar CPU, que dejó
    (1) en otra resolución que (2) y (3).

    Este test cubre (2) contra (3): que el submuestreo del detector no mueva
    las coordenadas, y que el cuadro que se devuelve para la evidencia siga
    siendo el original a resolución completa.
    """
    roi = (400, 300, 1200, 900)
    frame = _frame(40, size=(1440, 2560))

    # Una marca SÓLO adentro del ROI: si el recorte se corriera, no aparece.
    frame[350:850, 450:1150] = 200

    d = MotionDetector(threshold=1.5, cooldown=0.0, roi=roi, warmup_frames=0)
    d.check(_frame(40, size=(1440, 2560)))
    disparo, snapshot = d.check(frame)

    assert disparo is True
    # (3) La evidencia es el cuadro ENTERO: `main.py` recorta después.
    assert snapshot.shape == frame.shape
    # Y ese recorte da exactamente la zona pedida, a resolución completa.
    recorte = roi_crop(snapshot, roi)
    assert recorte.shape[:2] == (900 - 300, 1200 - 400)
    # La marca cae adentro, o sea que el recorte mira donde tiene que mirar.
    assert recorte.max() == 200


def test_el_submuestreo_no_corre_la_zona_analizada():
    """Movimiento JUSTO afuera del ROI sigue sin disparar después de achicar.

    Es la prueba de que el `resize` de `_to_gray_roi` no desplaza el recorte:
    si lo hiciera, se colarían autos de la calle como ingresos falsos.
    """
    roi = (400, 300, 1200, 900)
    base = _frame(40, size=(1440, 2560))
    d = MotionDetector(threshold=1.5, cooldown=0.0, roi=roi, warmup_frames=0)
    d.check(base)

    afuera = base.copy()
    afuera[0:290, 0:390] = 255  # pegado al ROI pero afuera

    assert d.check(afuera)[0] is False
