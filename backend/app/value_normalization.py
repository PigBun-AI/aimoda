from __future__ import annotations

import json
import re
import unicodedata
from typing import Any
from uuid import UUID

CANONICAL_QUARTERS: tuple[str, ...] = ("早春", "春夏", "早秋", "秋冬")
CANONICAL_SEASON_GROUPS: tuple[str, ...] = ("春夏", "秋冬")
SEASON_GROUP_TO_QUARTERS: dict[str, tuple[str, ...]] = {
    "春夏": ("早春", "春夏"),
    "秋冬": ("早秋", "秋冬"),
}


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


def normalize_brand_key(value: Any) -> str | None:
    normalized = normalize_text_value(value)
    if not normalized:
        return None

    compact = unicodedata.normalize("NFKD", normalized)
    compact = "".join(char for char in compact if not unicodedata.combining(char)).casefold()
    alnum_only = re.sub(r"[^0-9a-z]+", "", compact)
    return alnum_only or None


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


def normalize_season_group_value(value: Any) -> str | None:
    normalized = normalize_text_value(value)
    if not normalized:
        return None

    compact = normalized.strip().lower().replace("_", " ").replace("-", " ")
    compact = " ".join(compact.split())
    alias_map = {
        "春夏": "春夏",
        "ss": "春夏",
        "spring summer": "春夏",
        "spring/summer": "春夏",
        "spring": "春夏",
        "summer": "春夏",
        "早春": "春夏",
        "resort": "春夏",
        "cruise": "春夏",
        "pre spring": "春夏",
        "pre-spring": "春夏",
        "q1": "春夏",
        "q2": "春夏",
        "秋冬": "秋冬",
        "fw": "秋冬",
        "aw": "秋冬",
        "fall winter": "秋冬",
        "fall/winter": "秋冬",
        "autumn winter": "秋冬",
        "autumn/winter": "秋冬",
        "fall": "秋冬",
        "winter": "秋冬",
        "早秋": "秋冬",
        "pre fall": "秋冬",
        "pre-fall": "秋冬",
        "prefall": "秋冬",
        "pf": "秋冬",
        "q3": "秋冬",
        "q4": "秋冬",
    }
    return alias_map.get(compact)


def normalize_season_group_list(value: Any) -> list[str]:
    if value is None:
        return []

    normalized: list[str] = []
    for item in normalize_string_list_value(value):
        season_group = normalize_season_group_value(item)
        if season_group and season_group not in normalized:
            normalized.append(season_group)
    return normalized


def expand_season_groups_to_quarters(value: Any) -> list[str]:
    expanded: list[str] = []
    for season_group in normalize_season_group_list(value):
        for quarter in SEASON_GROUP_TO_QUARTERS.get(season_group, ()):
            if quarter not in expanded:
                expanded.append(quarter)
    return expanded


def normalize_year_value(value: Any) -> int | None:
    if value in (None, ""):
        return None
    try:
        year = int(value)
    except (TypeError, ValueError):
        return None
    return year if 1900 <= year <= 2100 else None


def normalize_year_list(value: Any) -> list[int]:
    if value is None:
        return []

    normalized: list[int] = []
    if isinstance(value, (list, tuple, set)):
        raw_items = value
    else:
        raw_items = normalize_string_list_value(value)

    for item in raw_items:
        year = normalize_year_value(item)
        if year is not None and year not in normalized:
            normalized.append(year)
    return sorted(normalized, reverse=True)


def normalize_site_value(value: Any) -> str | None:
    normalized = normalize_text_value(value)
    if not normalized:
        return None
    compact = normalized.strip().lower().replace("_", "-").replace(" ", "-")
    compact = "-".join(segment for segment in compact.split("-") if segment)
    return compact or None


def normalize_site_list(value: Any) -> list[str]:
    if value is None:
        return []

    normalized: list[str] = []
    for item in normalize_string_list_value(value):
        site = normalize_site_value(item)
        if site and site not in normalized:
            normalized.append(site)
    return normalized


def normalize_image_type_value(value: Any) -> str | None:
    normalized = normalize_text_value(value)
    if not normalized:
        return None

    compact = normalized.strip().lower().replace("_", " ").replace("-", " ")
    compact = " ".join(compact.split())
    alias_map = {
        "model photo": "model_photo",
        "model": "model_photo",
        "look": "model_photo",
        "runway": "model_photo",
        "模特图": "model_photo",
        "flat lay": "flat_lay",
        "flatlay": "flat_lay",
        "still life": "flat_lay",
        "still life photo": "flat_lay",
        "still": "flat_lay",
        "static": "flat_lay",
        "静物图": "flat_lay",
        "平铺图": "flat_lay",
    }
    if compact in alias_map:
        return alias_map[compact]

    underscored = compact.replace(" ", "_")
    if underscored in {"model_photo", "flat_lay"}:
        return underscored
    return None


def normalize_image_type_list(value: Any) -> list[str]:
    if value is None:
        return []

    order = {"model_photo": 0, "flat_lay": 1}
    normalized: list[str] = []
    for item in normalize_string_list_value(value):
        image_type = normalize_image_type_value(item)
        if image_type and image_type not in normalized:
            normalized.append(image_type)
    return sorted(normalized, key=lambda item: (order.get(item, 99), item))
