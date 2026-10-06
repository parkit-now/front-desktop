"""Local image storage and SQLite metadata persistence.

Disk layout:
    <images_dir>/<tenant_id>/<yyyy-mm-dd>/<uuid>.jpg

SQLite schema (WAL mode for concurrent read/write from multiple threads):
    captures(id, path, timestamp, camera_id, location, plate, confidence, event_id)

Both the images directory and the SQLite file are created automatically on
first use.
"""

import logging
import json
import os
import sqlite3
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from threading import Lock

import cv2
import numpy as np

logger = logging.getLogger(__name__)

_JPEG_PARAMS = [cv2.IMWRITE_JPEG_QUALITY, 85]


class LocalStorage:

    def __init__(self, db_path: str, images_dir: str, tenant_id: str) -> None:
        self._images_dir = Path(images_dir)
        self._tenant_id = tenant_id
        self._conn = sqlite3.connect(db_path, check_same_thread=False)
        self._lock = Lock()
        self._closed = False
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.execute("CREATE TABLE IF NOT EXISTS lpr_rule_snapshot (id INTEGER PRIMARY KEY CHECK (id = 1), payload TEXT NOT NULL)")
        self._conn.execute("""
            CREATE TABLE IF NOT EXISTS captures (
                id          TEXT PRIMARY KEY,
                path        TEXT NOT NULL,
                timestamp   TEXT NOT NULL,
                camera_id   TEXT NOT NULL,
                location    TEXT,
                plate       TEXT,
                confidence  REAL,
                event_id    TEXT,
                bbox        TEXT
            )
        """)
        try:
            self._conn.execute("ALTER TABLE captures ADD COLUMN bbox TEXT")
        except sqlite3.OperationalError:
            pass  # column already present
        self._conn.execute("""
            CREATE TABLE IF NOT EXISTS lpr_detection_events (
                id                 TEXT PRIMARY KEY,
                tenant_id          TEXT NOT NULL,
                camera_id          TEXT NOT NULL,
                location           TEXT NOT NULL,
                first_seen_at      TEXT NOT NULL,
                last_seen_at       TEXT NOT NULL,
                raw_text           TEXT,
                normalized_text    TEXT,
                display_plate      TEXT,
                confidence         REAL NOT NULL DEFAULT 0,
                format_valid       INTEGER NOT NULL DEFAULT 0,
                format_type        TEXT NOT NULL DEFAULT 'unknown',
                quality_status     TEXT NOT NULL DEFAULT 'low_confidence',
                status             TEXT NOT NULL DEFAULT 'pending',
                entry_id           TEXT,
                reviewed_at        TEXT,
                image_storage_path TEXT,
                image_url          TEXT,
                best_capture_id    TEXT,
                candidates         TEXT NOT NULL DEFAULT '[]',
                plate_bbox         TEXT,
                version            INTEGER NOT NULL DEFAULT 1,
                sync_seq           INTEGER NOT NULL DEFAULT 0,
                created_at         TEXT NOT NULL,
                updated_at         TEXT NOT NULL
            )
        """)
        self._conn.execute(
            "CREATE INDEX IF NOT EXISTS lpr_events_status_idx "
            "ON lpr_detection_events(status, last_seen_at)"
        )
        self._conn.execute(
            "CREATE INDEX IF NOT EXISTS lpr_events_plate_status_idx "
            "ON lpr_detection_events(normalized_text, status)"
        )
        # Aditiva e idempotente, igual que `captures.bbox`: una base creada por
        # una versión anterior no tiene esta columna y el CREATE TABLE de arriba
        # no la agrega porque la tabla ya existe.
        try:
            self._conn.execute(
                "ALTER TABLE lpr_detection_events ADD COLUMN plate_bbox TEXT"
            )
        except sqlite3.OperationalError:
            pass  # column already present
        self._conn.commit()
        logger.info("storage_ready", extra={"db": db_path, "images_dir": images_dir})

    def load_rule_snapshot(self) -> dict | None:
        with self._lock:
            row = self._conn.execute("SELECT payload FROM lpr_rule_snapshot WHERE id = 1").fetchone()
        return json.loads(row[0]) if row else None

    def save_rule_snapshot(self, snapshot: dict) -> None:
        with self._lock:
            self._conn.execute("INSERT INTO lpr_rule_snapshot(id, payload) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload", (json.dumps(snapshot),))
            self._conn.commit()

    def save(
        self,
        frame: np.ndarray,
        camera_id: str,
        location: str,
        lpr_result: dict | None = None,
        event_id: str | None = None,
        bbox: tuple[int, int, int, int] | None = None,
    ) -> str:
        """Persist a frame to disk and its metadata to SQLite.

        Returns the capture UUID. Raises IOError if the JPEG write fails so the
        caller knows the capture was not actually stored — no SQLite row is
        inserted in that case. ``bbox`` (x1,y1,x2,y2 of the plate in the saved
        frame) is stored so the UI can later crop the image to the plate.
        """
        capture_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc)
        timestamp = now.isoformat()
        date_str = now.strftime("%Y-%m-%d")

        # Disk: images/<tenant_id>/<yyyy-mm-dd>/<uuid>.jpg
        img_dir = self._images_dir / self._tenant_id / date_str
        img_dir.mkdir(parents=True, exist_ok=True)
        img_path = img_dir / f"{capture_id}.jpg"

        ok = cv2.imwrite(str(img_path), frame, _JPEG_PARAMS)
        if not ok:
            raise IOError(f"cv2.imwrite failed — check disk space and permissions: {img_path}")

        plate = lpr_result["plate"] if lpr_result else None
        confidence = lpr_result["confidence"] if lpr_result else None
        bbox_str = ",".join(str(int(v)) for v in bbox) if bbox else None

        with self._lock:
            self._conn.execute(
                """INSERT INTO captures
                   (id, path, timestamp, camera_id, location, plate, confidence, event_id, bbox)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    capture_id,
                    str(img_path),
                    timestamp,
                    camera_id,
                    location,
                    plate,
                    confidence,
                    event_id,
                    bbox_str,
                ),
            )
            self._conn.commit()
        logger.info(
            "capture_saved",
            extra={"id": capture_id, "plate": plate, "confidence": confidence, "event_id": event_id},
        )
        return capture_id

    def upsert_lpr_event(self, event: dict) -> dict:
        """Persist an auditable LPR event and return the stored row."""
        now = _now_iso()
        row = {
            "id": event["id"],
            "tenant_id": self._tenant_id,
            "camera_id": event["camera_id"],
            "location": event["location"],
            "first_seen_at": event["first_seen_at"],
            "last_seen_at": event["last_seen_at"],
            "raw_text": event.get("raw_text"),
            "normalized_text": event.get("normalized_text"),
            "display_plate": event.get("display_plate"),
            "confidence": float(event.get("confidence") or 0),
            "format_valid": 1 if event.get("format_valid") else 0,
            "format_type": event.get("format_type") or "unknown",
            "quality_status": event.get("quality_status") or "low_confidence",
            "status": event.get("status") or "pending",
            "entry_id": event.get("entry_id"),
            "reviewed_at": event.get("reviewed_at"),
            "image_storage_path": event.get("image_storage_path"),
            "image_url": event.get("image_url"),
            "best_capture_id": event.get("best_capture_id"),
            "candidates": json.dumps(event.get("candidates") or []),
            "plate_bbox": (
                json.dumps(event["plate_bbox"])
                if event.get("plate_bbox") is not None
                else None
            ),
            "updated_at": now,
        }
        with self._lock:
            self._conn.execute(
                """INSERT INTO lpr_detection_events (
                       id, tenant_id, camera_id, location, first_seen_at, last_seen_at,
                       raw_text, normalized_text, display_plate, confidence,
                       format_valid, format_type, quality_status, status, entry_id,
                       reviewed_at, image_storage_path, image_url, best_capture_id,
                       candidates, plate_bbox, created_at, updated_at
                   ) VALUES (
                       :id, :tenant_id, :camera_id, :location, :first_seen_at, :last_seen_at,
                       :raw_text, :normalized_text, :display_plate, :confidence,
                       :format_valid, :format_type, :quality_status, :status, :entry_id,
                       :reviewed_at, :image_storage_path, :image_url, :best_capture_id,
                       :candidates, :plate_bbox, :updated_at, :updated_at
                   )
                   ON CONFLICT(id) DO UPDATE SET
                       camera_id = excluded.camera_id,
                       location = excluded.location,
                       first_seen_at = excluded.first_seen_at,
                       last_seen_at = excluded.last_seen_at,
                       raw_text = excluded.raw_text,
                       normalized_text = excluded.normalized_text,
                       display_plate = excluded.display_plate,
                       confidence = excluded.confidence,
                       format_valid = excluded.format_valid,
                       format_type = excluded.format_type,
                       quality_status = excluded.quality_status,
                       status = excluded.status,
                       entry_id = excluded.entry_id,
                       reviewed_at = excluded.reviewed_at,
                       image_storage_path = excluded.image_storage_path,
                       image_url = excluded.image_url,
                       best_capture_id = excluded.best_capture_id,
                       candidates = excluded.candidates,
                       plate_bbox = excluded.plate_bbox,
                       version = version + 1,
                       updated_at = excluded.updated_at""",
                row,
            )
            self._conn.commit()
        return self.get_lpr_event(event["id"])

    def get_lpr_event(self, event_id: str) -> dict | None:
        cur = self._conn.execute(
            """SELECT *
               FROM lpr_detection_events
               WHERE id = ?""",
            (event_id,),
        )
        row = cur.fetchone()
        if row is None:
            return None
        cols = [d[0] for d in cur.description]
        return _event_row_to_dict(dict(zip(cols, row)))

    def mark_lpr_event_uploaded(self, event_id: str, storage_path: str) -> bool:
        """Anotar que la imagen de este evento ya está en la nube.

        Lo avisa el renderer, que es quien la sube. Este servicio no habla con
        el backend, así que sin este aviso no tendría forma de saber qué
        archivos ya están respaldados — y la purga no puede borrar nada que no
        lo esté.
        """
        with self._lock:
            cur = self._conn.execute(
                """UPDATE lpr_detection_events
                   SET image_storage_path = ?, updated_at = ?
                   WHERE id = ?""",
                (storage_path, _now_iso(), event_id),
            )
            self._conn.commit()
        return cur.rowcount > 0

    def purge_images_older_than(self, days: int) -> dict:
        """Borrar las imágenes viejas QUE YA ESTÉN RESPALDADAS.

        Sin esto el directorio crece para siempre: no había ninguna retención
        local, y en una playa de 200 ingresos diarios son ~15 GB al año en la
        PC del estacionamiento. El job del backend borra del bucket, no de acá.

        LA CONDICIÓN DE «YA SUBIDA» NO ES NEGOCIABLE

        Borrar una captura que todavía no se sincronizó pierde la evidencia
        justo del período en que la playa estuvo sin internet, que es cuando
        más importa. Por eso sólo se borra lo que cae en alguno de estos casos:

          * el evento tiene `image_storage_path` — está en la nube;
          * el evento es `suppressed_pending_event` — un duplicado, que
            `pushLprDetectionEventImages` nunca va a subir;
          * no hay evento — huérfana de una versión vieja, nadie la va a subir.

        Una captura sin subir de un evento vivo se queda donde está, por más
        vieja que sea. Si eso pasa seguido es que el equipo lleva mucho sin
        sincronizar, y el aviso del log es más útil que el espacio liberado.
        """
        cutoff = (
            datetime.now(timezone.utc) - timedelta(days=days)
        ).isoformat()
        with self._lock:
            rows = self._conn.execute(
                """SELECT c.id, c.path
                   FROM captures c
                   LEFT JOIN lpr_detection_events e ON e.id = c.event_id
                   WHERE c.timestamp < ?
                     AND (e.image_storage_path IS NOT NULL
                          OR e.status = 'suppressed_pending_event'
                          OR e.id IS NULL)""",
                (cutoff,),
            ).fetchall()
            retenidas = self._conn.execute(
                """SELECT COUNT(*)
                   FROM captures c
                   JOIN lpr_detection_events e ON e.id = c.event_id
                   WHERE c.timestamp < ?
                     AND e.image_storage_path IS NULL
                     AND e.status != 'suppressed_pending_event'""",
                (cutoff,),
            ).fetchone()[0]

            borradas, bytes_liberados = 0, 0
            for capture_id, path in rows:
                try:
                    size = os.path.getsize(path)
                    os.remove(path)
                    bytes_liberados += size
                except FileNotFoundError:
                    pass  # ya no estaba; la fila se limpia igual
                except OSError as exc:
                    logger.warning(
                        "purge_delete_failed", extra={"path": path, "error": str(exc)}
                    )
                    continue
                # La fila se borra aunque el archivo ya no estuviera: si no, la
                # tabla crece igual que el disco y la volvemos a mirar siempre.
                self._conn.execute("DELETE FROM captures WHERE id = ?", (capture_id,))
                borradas += 1
            self._conn.commit()

        if borradas or retenidas:
            logger.info(
                "purge_done",
                extra={
                    "borradas": borradas,
                    "mb_liberados": round(bytes_liberados / 1_048_576, 1),
                    "retenidas_sin_subir": retenidas,
                },
            )
        if retenidas:
            logger.warning(
                "%d capturas de más de %d días siguen en disco porque todavía "
                "no se subieron. Si el número crece, este equipo no está "
                "sincronizando.",
                retenidas,
                days,
            )
        return {
            "deleted": borradas,
            "freedBytes": bytes_liberados,
            "keptUnsynced": retenidas,
        }

    def list_pending_lpr_events(self) -> list[dict]:
        """Return pending LPR events ordered newest first."""
        cur = self._conn.execute(
            """SELECT *
               FROM lpr_detection_events
               WHERE status = 'pending'
               ORDER BY last_seen_at DESC"""
        )
        cols = [d[0] for d in cur.description]
        return [_event_row_to_dict(dict(zip(cols, row))) for row in cur.fetchall()]

    def update_lpr_event_status(
        self,
        event_id: str,
        status: str,
        entry_id: str | None = None,
    ) -> dict | None:
        """Mark an LPR event as registered, dismissed or suppressed."""
        now = _now_iso()
        with self._lock:
            self._conn.execute(
                """UPDATE lpr_detection_events
                   SET status = ?,
                       entry_id = COALESCE(?, entry_id),
                       reviewed_at = ?,
                       version = version + 1,
                       updated_at = ?
                   WHERE id = ?""",
                (status, entry_id, now, now, event_id),
            )
            self._conn.commit()
        return self.get_lpr_event(event_id)

    def get(self, capture_id: str) -> dict | None:
        """Return a single capture row by id (incl. path + bbox), or None."""
        cur = self._conn.execute(
            """SELECT id, path, timestamp, camera_id, location, plate, confidence, event_id, bbox
               FROM captures WHERE id = ?""",
            (capture_id,),
        )
        row = cur.fetchone()
        if row is None:
            return None
        cols = [d[0] for d in cur.description]
        return dict(zip(cols, row))

    def list_recent(self, limit: int = 20) -> list[dict]:
        """Return the most recent captures ordered by timestamp descending."""
        cur = self._conn.execute(
            """SELECT id, path, timestamp, camera_id, location, plate, confidence, event_id
               FROM captures
               ORDER BY timestamp DESC
               LIMIT ?""",
            (limit,),
        )
        cols = [d[0] for d in cur.description]
        return [dict(zip(cols, row)) for row in cur.fetchall()]

    def close(self) -> None:
        """Flush and close the SQLite connection during service shutdown."""
        with self._lock:
            if self._closed:
                return
            try:
                self._conn.commit()
                self._conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
            except sqlite3.Error as exc:
                logger.warning("storage_close_checkpoint_failed", extra={"error": str(exc)})
            finally:
                self._conn.close()
                self._closed = True


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _event_row_to_dict(row: dict) -> dict:
    candidates_raw = row.get("candidates") or "[]"
    try:
        candidates = json.loads(candidates_raw)
    except json.JSONDecodeError:
        candidates = []
    # None acá NO es "falta el dato": significa que la imagen de este evento es
    # del formato viejo —el recorte de la patente— y que no hay que recortarla
    # de nuevo del otro lado.
    plate_bbox = None
    if row.get("plate_bbox"):
        try:
            plate_bbox = json.loads(row["plate_bbox"])
        except json.JSONDecodeError:
            plate_bbox = None
    event = {
        "id": row["id"],
        "eventId": row["id"],
        "tenantId": row["tenant_id"],
        "cameraId": row["camera_id"],
        "camera_id": row["camera_id"],
        "location": row["location"],
        "firstSeenAt": row["first_seen_at"],
        "lastSeenAt": row["last_seen_at"],
        "detected_at": row["last_seen_at"],
        "rawText": row["raw_text"],
        "normalizedText": row["normalized_text"],
        "displayPlate": row["display_plate"],
        "plate": row["display_plate"] or row["normalized_text"] or row["raw_text"] or "",
        "text": row["normalized_text"] or "",
        "confidence": row["confidence"],
        "formatValid": bool(row["format_valid"]),
        "formatType": row["format_type"],
        "qualityStatus": row["quality_status"],
        "status": row["status"],
        "entryId": row["entry_id"],
        "reviewedAt": row["reviewed_at"],
        "imageStoragePath": row["image_storage_path"],
        "imageUrl": row["image_url"],
        "bestCaptureId": row["best_capture_id"],
        "capture_id": row["best_capture_id"],
        "candidates": candidates,
        "plateBbox": plate_bbox,
        "version": row["version"],
        "syncSeq": row["sync_seq"],
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }
    return event
