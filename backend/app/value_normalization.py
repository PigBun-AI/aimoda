from __future__ import annotations

import json
from typing import Any
from uuid import UUID

CANONICAL_QUARTERS: tuple[str, ...] = ("早春", "春夏", "早秋", "秋冬")


def normalize_text_value(value: Any, *, separator: str = " / ") -> str | None:
    if value is None:
        return None

    if isinstance(value, str):
        normalized = value.strip()
        return normalized or None

    if isinstance(value, (list, tuple, set)):
        parts: list[str] = []
        for item in value:
            normalized = normalize_text_value(item, separator=separator)
            if normalized:
                parts.append(normalized)
        if not parts:
            return None
        return separator.join(dict.fromkeys(parts))

    normalized = str(value).strip()
    return normalized or None


def normalize_string_list_value(value: Any) -> list[str]:
    if value is None:
        return []

    if isinstance(value, str):
        normalized = value.strip()
        if not normalized:
            return []

        if normalized.startswith("[") and normalized.endswith("]"):
            try:
                parsed = json.loads(normalized)
            except json.JSONDecodeError:
                parsed = None
            if isinstance(parsed, list):
                return normalize_string_list_value(parsed)

        if "," in normalized or "，" in normalized:
            segments = normalized.replace("，", ",").split(",")
            result: list[str] = []
            for segment in segments:
                text = normalize_text_value(segment)
                if text and text not in result:
                    result.append(text)
            return result

        return [normalized]

    if isinstance(value, (list, tuple, set)):
        result: list[str] = []
        for item in value:
            text = normalize_text_value(item)
            if text and text not in result:
                result.append(text)
        return result

    text = normalize_text_value(value)
    return [text] if text else []


def normalize_qdrant_point_id(value: Any) -> int | str | None:
    if isinstance(value, int) and value >= 0:
        return value

    normalized = normalize_text_value(value)
    if not normalized:
        return None

    if normalized.isdigit():
        return int(normalized)

    try:
        UUID(normalized)
    except ValueError:
        return None
    return normalized


def normalize_quarter_value(value: Any) -> str | None:
    normalized = normalize_text_value(value)
    if not normalized:
        return None

    compact = normalized.strip().lower().replace("_", " ").replace("-", " ")
    compact = " ".join(compact.split())
    alias_map = {
        "早春": "早春",
        "resort": "早春",
        "cruise": "早春",
        "pre spring": "早春",
        "pre-spring": "早春",
        "q1": "早春",
        "春夏": "春夏",
        "ss": "春夏",
        "spring summer": "春夏",
        "spring/summer": "春夏",
        "spring": "春夏",
        "summer": "春夏",
        "q2": "春夏",
        "早秋": "早秋",
        "prefall": "早秋",
        "pre fall": "早秋",
        "pre-fall": "早秋",
        "pf": "早秋",
        "q3": "早秋",
        "秋冬": "秋冬",
        "fw": "秋冬",
        "aw": "秋冬",
        "fall winter": "秋冬",
        "fall/winter": "秋冬",
        "autumn winter": "秋冬",
        "autumn/winter": "秋冬",
        "fall": "秋冬",
        "winter": "秋冬",
        "q4": "秋冬",
    }
    return alias_map.get(compact)


def normalize_quarter_list(value: Any) -> list[str]:
    if value is None:
        return []

    normalized: list[str] = []
    for item in normalize_string_list_value(value):
        quarter = normalize_quarter_value(item)
        if quarter and quarter not in normalized:
            normalized.append(quarter)
    return normalized
