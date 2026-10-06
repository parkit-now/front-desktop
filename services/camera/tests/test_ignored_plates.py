from datetime import datetime, timezone

import pytest

import main
from ignored_plates import is_ignored, parse_snapshot
from storage import LocalStorage
from test_supresion import _cluster, _StorageFalso


def test_argentina_days_and_exact_match():
    snapshot = parse_snapshot("apex", [{"plate": "iag-574", "validFrom": "2026-10-06", "validUntil": "2026-10-06"}])
    assert not is_ignored("IAG574", snapshot, datetime(2026, 10, 6, 2, 59, tzinfo=timezone.utc))
    assert is_ignored("IAG 574", snapshot, datetime(2026, 10, 6, 3, tzinfo=timezone.utc))
    assert is_ignored("IAG574", snapshot, datetime(2026, 10, 7, 2, 59, tzinfo=timezone.utc))
    assert not is_ignored("IAG574", snapshot, datetime(2026, 10, 7, 3, tzinfo=timezone.utc))
    assert not is_ignored("IAG575", snapshot, datetime(2026, 10, 6, 12, tzinfo=timezone.utc))


def test_ignored_vehicle_does_not_create_capture_or_event(monkeypatch):
    storage = _StorageFalso()
    monkeypatch.setattr(main, "_storage", storage)
    monkeypatch.setattr(main, "_ignored_plate_snapshot", parse_snapshot("apex", [{"plate": "AB123CD"}]))
    assert main._persist_cluster(_cluster()) is None
    assert storage.guardados == []


def test_testing_bypasses_whitelist(monkeypatch):
    storage = _StorageFalso()
    monkeypatch.setattr(main, "_storage", storage)
    monkeypatch.setattr(main, "_last_saved_by_plate", {})
    monkeypatch.setattr(main, "_ignored_plate_snapshot", parse_snapshot("apex", [{"plate": "AB123CD"}]))
    monkeypatch.setattr(main, "_testing_mode_at", main.time.monotonic())
    assert main._persist_cluster(_cluster()) is not None
    assert storage.guardados == ["AB123CD"]
    monkeypatch.setattr(main, "_testing_mode_at", None)
    assert main._persist_cluster(_cluster()) is None


def test_snapshot_survives_restart_and_replaces_tenant(tmp_path):
    path = str(tmp_path / "camera.db")
    store = LocalStorage(path, str(tmp_path / "images"), "apex")
    snapshot = parse_snapshot("apex", [{"plate": "IAG574"}])
    store.save_rule_snapshot(snapshot)
    store.close()
    store = LocalStorage(path, str(tmp_path / "images"), "other")
    assert store.load_rule_snapshot() == snapshot
    store.save_rule_snapshot(parse_snapshot("other", []))
    assert not is_ignored("IAG574", store.load_rule_snapshot())
    store.close()


def test_known_plates_replaces_and_persists_rules(monkeypatch, tmp_path):
    store = LocalStorage(str(tmp_path / "camera.db"), str(tmp_path / "images"), "apex")
    monkeypatch.setattr(main, "_storage", store)
    try:
        main.set_known_plates({"tenantId": "apex", "plates": [], "ignoredPlates": [{"plate": "IAG574"}]})
        assert is_ignored("IAG574", store.load_rule_snapshot())
        main.set_known_plates({"plates": [], "testingMode": True})
        assert is_ignored("IAG574", store.load_rule_snapshot())
        assert main._testing_mode()
        main.set_known_plates({"tenantId": "other", "plates": [], "ignoredPlates": []})
        assert store.load_rule_snapshot() == {"tenantId": "other", "ignoredPlates": []}
        assert not main._testing_mode()
        assert not is_ignored("IAG574", main._ignored_plate_snapshot)
    finally:
        store.close()


@pytest.mark.parametrize("rules", [[{"plate": ""}], [{"plate": "IAG574", "validFrom": "2026-02-30"}], [{"plate": "IAG574", "validFrom": "2026-10-07", "validUntil": "2026-10-06"}]])
def test_invalid_snapshot(rules):
    with pytest.raises(ValueError):
        parse_snapshot("apex", rules)
