"""Que el servicio pueda escribir su salida sin importar la consola.

En Windows este servicio arrancaba y se moría en el acto, tres veces seguidas,
sin dejar nada en el Administrador de tareas. La causa era un `─` del banner
contra una consola cp1252: el UnicodeEncodeError subía por el `lifespan` de
Starlette y la aplicación no llegaba a arrancar.

Las variables PYTHONUTF8/PYTHONIOENCODING que pasa Electron no lo cubrían: el
binario de PyInstaller arranca el intérprete en modo aislado y las ignora.
"""

import io

import pytest

import main


class _StreamFalso:
    def __init__(self):
        self.calls = []

    def reconfigure(self, **kwargs):
        self.calls.append(kwargs)


def test_reconfigura_a_utf8_tolerando_lo_que_no_entre():
    stream = _StreamFalso()
    main._force_utf8_stdio((stream,))
    assert stream.calls == [{"encoding": "utf-8", "errors": "replace"}]


def test_un_stream_sin_reconfigure_no_rompe():
    """En un build sin consola `sys.stdout` puede ser None."""
    main._force_utf8_stdio((None, object()))


def test_un_stream_que_falla_no_impide_arrancar():
    """Perder un log nunca puede tirar abajo la detección de patentes."""

    class Roto:
        def reconfigure(self, **kwargs):
            raise ValueError("stream cerrado")

    main._force_utf8_stdio((Roto(),))


def test_el_banner_no_se_puede_escribir_en_cp1252():
    r"""Fija POR QUÉ hace falta el arreglo.

    Si alguien algún día saca los caracteres de dibujo del banner, este test se
    cae y hay que decidir a conciencia si `_force_utf8_stdio` sigue haciendo
    falta — spoiler: sí, porque los logs del servicio están en castellano y
    tienen acentos.
    """
    separador = "─" * 60
    with pytest.raises(UnicodeEncodeError):
        separador.encode("cp1252")


def test_la_barra_de_confianza_tampoco_entra_en_cp1252():
    """El segundo crash que estaba esperando turno.

    Arreglar sólo el banner no alcanzaba: `_conf_bar` dibuja la confianza del
    LPR con bloques, y eso se imprime en CADA detección. El servicio habría
    arrancado bien y se habría muerto con el primer auto.
    """
    for bloque in ("█", "░"):
        with pytest.raises(UnicodeEncodeError):
            bloque.encode("cp1252")


def test_los_acentos_castellanos_SI_entran_en_cp1252():
    """Contra la intuición, y vale dejarlo escrito.

    cp1252 cubre el latín-1, así que "detección" o "configuración" nunca fueron
    el problema. El problema son los caracteres de dibujo. Quien venga a mirar
    esto no tiene por qué perder el tiempo sospechando de los acentos.
    """
    for texto in ("detección", "configuración", "cámara", "—"):
        texto.encode("cp1252")


def test_una_salida_utf8_aguanta_todo_lo_que_imprime_el_servicio():
    """La contracara: con UTF-8 no hay nada que no se pueda escribir."""
    buffer = io.TextIOWrapper(io.BytesIO(), encoding="utf-8", errors="replace")
    buffer.write("─" * 60)
    buffer.write("  Parkit — Camera Service")
    buffer.write("  confianza [███░░] 60%  sin zona de detección")
    buffer.flush()
