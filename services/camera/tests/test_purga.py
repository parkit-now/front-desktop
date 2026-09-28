"""La purga borra lo viejo YA RESPALDADO, y nada más.

Antes no existía ninguna retención local: el directorio de imágenes crecía
para siempre (~15 GB al año en una playa de 200 ingresos diarios). El job del
backend borra del bucket, no del disco del equipo.
"""

from datetime import datetime, timedelta, timezone

import numpy as np
import pytest

from storage import LocalStorage


def _hace(dias):
    return (datetime.now(timezone.utc) - timedelta(days=dias)).isoformat()


@pytest.fixture
def store(tmp_path):
    s = LocalStorage(str(tmp_path / "c.db"), str(tmp_path / "img"), "t1")
    yield s
    s.close()


def _capturar(store, event_id, status="pending", subida=False, dias=0):
    """Una captura con su evento, envejecida a mano."""
    capture_id = store.save(
        np.zeros((80, 120, 3), dtype=np.uint8),
        "cam-01",
        "entrada",
        lpr_result={"plate": event_id, "confidence": 0.9},
        event_id=event_id,
        bbox=(10, 10, 60, 40),
    )
    store.upsert_lpr_event({
        "id": event_id,
        "camera_id": "cam-01",
        "location": "entrada",
        "first_seen_at": _hace(dias),
        "last_seen_at": _hace(dias),
        "status": status,
        "best_capture_id": capture_id,
        "candidates": [],
    })
    if subida:
        store.mark_lpr_event_uploaded(event_id, f"t1/{event_id}.jpg")
    store._conn.execute(
        "UPDATE captures SET timestamp = ? WHERE id = ?", (_hace(dias), capture_id)
    )
    store._conn.commit()
    return capture_id, store.get(capture_id)["path"]


def _existe(path):
    import os
    return os.path.exists(path)


def test_borra_lo_viejo_ya_subido(store):
    _, path = _capturar(store, "e1", subida=True, dias=30)
    r = store.purge_images_older_than(14)
    assert r["deleted"] == 1
    assert not _existe(path)
    assert r["freedBytes"] > 0


def test_NO_borra_lo_que_todavia_no_se_subio(store):
    """La regla que no se negocia: sería perder la evidencia de un corte."""
    _, path = _capturar(store, "e1", subida=False, dias=90)
    r = store.purge_images_older_than(14)
    assert r["deleted"] == 0
    assert r["keptUnsynced"] == 1
    assert _existe(path), "borró una captura que nunca llegó a la nube"


def test_no_borra_lo_reciente_aunque_este_subido(store):
    _, path = _capturar(store, "e1", subida=True, dias=2)
    assert store.purge_images_older_than(14)["deleted"] == 0
    assert _existe(path)


def test_borra_los_duplicados_suprimidos_que_nunca_se_van_a_subir(store):
    # `pushLprDetectionEventImages` saltea este estado a propósito, así que su
    # imagen no se sube nunca. Sin este caso quedaría en disco para siempre.
    _, path = _capturar(store, "e1", status="suppressed_pending_event", dias=30)
    assert store.purge_images_older_than(14)["deleted"] == 1
    assert not _existe(path)


def test_borra_huerfanas_de_versiones_viejas(store):
    capture_id = store.save(
        np.zeros((80, 120, 3), dtype=np.uint8), "cam-01", "entrada",
        lpr_result={"plate": "X", "confidence": 0.5}, event_id=None, bbox=None,
    )
    path = store.get(capture_id)["path"]
    store._conn.execute(
        "UPDATE captures SET timestamp = ? WHERE id = ?", (_hace(40), capture_id)
    )
    store._conn.commit()
    assert store.purge_images_older_than(14)["deleted"] == 1
    assert not _existe(path)


def test_limpia_la_fila_aunque_el_archivo_ya_no_este(store):
    """Si no, la tabla crece igual que el disco y la revisamos para siempre."""
    import os
    capture_id, path = _capturar(store, "e1", subida=True, dias=30)
    os.remove(path)
    assert store.purge_images_older_than(14)["deleted"] == 1
    assert store.get(capture_id) is None


def test_separa_bien_una_tanda_mezclada(store):
    _capturar(store, "vieja-subida", subida=True, dias=30)
    _capturar(store, "vieja-sin-subir", subida=False, dias=30)
    _capturar(store, "nueva-subida", subida=True, dias=1)
    _capturar(store, "duplicada", status="suppressed_pending_event", dias=30)
    r = store.purge_images_older_than(14)
    assert r["deleted"] == 2, "esperaba la vieja subida y la duplicada"
    assert r["keptUnsynced"] == 1


def test_marcar_subida_un_evento_que_no_existe(store):
    assert store.mark_lpr_event_uploaded("no-existe", "t1/x.jpg") is False
