"""Local image storage and SQLite metadata persistence.

Disk layout:
    <images_dir>/<tenant_id>/<yyyy-mm-dd>/<uuid>.jpg

SQLite schema (WAL mode for concurrent read/write from multiple threads):
    captures(id, path, timestamp, camera_id, location, plate, confidence, event_id)

Both the images directory and the SQLite file are created automatically on
first use.
"""

import logging
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path

import cv2
import numpy as np

logger = logging.getLogger(__name__)

_JPEG_PARAMS = [cv2.IMWRITE_JPEG_QUALITY, 85]


class LocalStorage:

    def __init__(self, db_path: str, images_dir: str, tenant_id: str) -> None:
        self._images_dir = Path(images_dir)
        self._tenant_id = tenant_id
        self._conn = sqlite3.connect(db_path, check_same_thread=False)
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.execute("""
            CREATE TABLE IF NOT EXISTS captures (
                id          TEXT PRIMARY KEY,
                path        TEXT NOT NULL,
                timestamp   TEXT NOT NULL,
                camera_id   TEXT NOT NULL,
                location    TEXT,
                plate       TEXT,
                confidence  REAL,
                event_id    TEXT
            )
        """)
        self._conn.commit()
        logger.info("storage_ready", extra={"db": db_path, "images_dir": images_dir})

    def save(
        self,
        frame: np.ndarray,
        camera_id: str,
        location: str,
        lpr_result: dict | None = None,
        event_id: str | None = None,
    ) -> str:
        """Persist a frame to disk and its metadata to SQLite.

        Returns the capture UUID. Raises IOError if the JPEG write fails so the
        caller knows the capture was not actually stored — no SQLite row is
        inserted in that case.
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

        self._conn.execute(
            """INSERT INTO captures
               (id, path, timestamp, camera_id, location, plate, confidence, event_id)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (capture_id, str(img_path), timestamp, camera_id, location, plate, confidence, event_id),
        )
        self._conn.commit()
        logger.info(
            "capture_saved",
            extra={"id": capture_id, "plate": plate, "confidence": confidence, "event_id": event_id},
        )
        return capture_id

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
