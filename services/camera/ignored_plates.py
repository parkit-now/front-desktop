"""Tenant-scoped LPR exclusions with inclusive Argentina calendar dates."""

import re
from datetime import date, datetime, timedelta, timezone

ARGENTINA = timezone(timedelta(hours=-3))


def normalize_plate(value: str) -> str:
    return re.sub(r"[\s_-]", "", value).upper()


def parse_snapshot(tenant_id, rules) -> dict:
    if tenant_id is not None and (not isinstance(tenant_id, str) or not tenant_id):
        raise ValueError("tenantId must be a non-empty string or null")
    if not isinstance(rules, list):
        raise ValueError("ignoredPlates must be an array")
    if rules and tenant_id is None:
        raise ValueError("tenantId is required for exclusions")
    result = []
    for rule in rules:
        if not isinstance(rule, dict) or not isinstance(rule.get("plate"), str):
            raise ValueError("Invalid ignored plate")
        plate = normalize_plate(rule["plate"])
        if not re.fullmatch(r"[A-Z0-9]{1,20}", plate):
            raise ValueError("Invalid ignored plate")
        start, end = rule.get("validFrom"), rule.get("validUntil")
        for value in (start, end):
            if value is not None:
                if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
                    raise ValueError("Validity must be a calendar date")
                date.fromisoformat(value)
        if start and end and start > end:
            raise ValueError("Invalid validity range")
        result.append({"plate": plate, "validFrom": start, "validUntil": end})
    return {"tenantId": tenant_id, "ignoredPlates": result}


def is_ignored(plate: str, snapshot: dict, now: datetime | None = None) -> bool:
    today = (now or datetime.now(timezone.utc)).astimezone(ARGENTINA).date().isoformat()
    normalized = normalize_plate(plate)
    return any(
        normalized == rule["plate"]
        and (not rule["validFrom"] or today >= rule["validFrom"])
        and (not rule["validUntil"] or today <= rule["validUntil"])
        for rule in snapshot.get("ignoredPlates", [])
    )
