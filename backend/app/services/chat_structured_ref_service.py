from __future__ import annotations

import json
import re
from typing import Any

from ..value_normalization import normalize_quarter_value
from .chat_reference_service import build_search_plan_ref

REFS_START_MARKER = "[AIMODA_REFS]"
REFS_END_MARKER = "[/AIMODA_REFS]"
_REFS_BLOCK_RE = re.compile(
    rf"{re.escape(REFS_START_MARKER)}(?P<payload>.*?){re.escape(REFS_END_MARKER)}",
    re.DOTALL,
)


def strip_structured_ref_payload(text: str) -> str:
    cleaned = _REFS_BLOCK_RE.sub("", str(text or ""))
    dangling_index = cleaned.find(REFS_START_MARKER)
    if dangling_index >= 0:
        cleaned = cleaned[:dangling_index]
    return cleaned.strip()


def _normalize_categories(value: Any) -> list[str]:
    if isinstance(value, list):
        raw_items = value
    elif value in (None, ""):
        raw_items = []
    else:
        raw_items = re.split(r"[|,]", str(value))

    categories: list[str] = []
    for item in raw_items:
        normalized = str(item or "").strip().lower()
        if normalized:
            categories.append(normalized)
    return list(dict.fromkeys(categories))


def _extract_ref_payload_items(text: str) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for match in _REFS_BLOCK_RE.finditer(text):
        raw_payload = str(match.group("payload") or "").strip()
        if not raw_payload:
            continue
        try:
            payload = json.loads(raw_payload)
        except json.JSONDecodeError:
            continue
        raw_items = payload.get("items")
        if not isinstance(raw_items, list):
            continue
        for item in raw_items:
            if isinstance(item, dict):
                items.append(dict(item))
    return items


def _append_structured_ref_annotations(
    *,
    text: str,
    session_id: str,
    items: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    annotations: list[dict[str, Any]] = []
    quote_occurrences: dict[str, int] = {}

    for item in items:
        quote = str(item.get("quote", "") or "").strip()
        if len(quote) < 2 or quote not in text:
            continue

        query = str(item.get("query", "") or "").strip()
        brand = str(item.get("brand", "") or "").strip() or None
        gender = str(item.get("gender", "") or "").strip().lower() or None
        quarter = normalize_quarter_value(item.get("quarter"))
        image_type = str(item.get("image_type", "") or "").strip() or None
        source = str(item.get("source", "") or "").strip() or "agent_structured_ref"
        label = str(item.get("label", "") or "").strip() or quote
        categories = _normalize_categories(item.get("categories"))

        year_min_raw = item.get("year_min")
        try:
            year_min = int(year_min_raw) if year_min_raw not in (None, "") else None
        except (TypeError, ValueError):
            year_min = None

        if not query and not brand:
            continue

        occurrence = quote_occurrences.get(quote, 0) + 1
        quote_occurrences[quote] = occurrence

        annotations.append({
            "quote": quote,
            "occurrence": occurrence,
            "label": label,
            "target": build_search_plan_ref(
                session_id=session_id,
                label=label,
                query=query,
                categories=categories,
                brand=brand,
                gender=gender,
                quarter=quarter,
                year_min=year_min,
                image_type=image_type,
                source=source,
            ),
        })

    return annotations


def attach_structured_message_refs(
    blocks: list[dict[str, Any]],
    *,
    session_id: str,
) -> tuple[list[dict[str, Any]], bool]:
    if not blocks:
        return blocks, False

    next_blocks: list[dict[str, Any]] = []
    attached_any = False

    for block in blocks:
        if not isinstance(block, dict) or block.get("type") != "text":
            next_blocks.append(dict(block) if isinstance(block, dict) else block)
            continue

        raw_text = str(block.get("text", "") or "")
        payload_items = _extract_ref_payload_items(raw_text)
        cleaned_text = strip_structured_ref_payload(raw_text)
        next_block = dict(block)
        next_block["text"] = cleaned_text

        if payload_items and cleaned_text:
            ref_items = _append_structured_ref_annotations(
                text=cleaned_text,
                session_id=session_id,
                items=payload_items,
            )
            if ref_items:
                existing_annotations = [
                    dict(annotation)
                    for annotation in (block.get("annotations") if isinstance(block.get("annotations"), list) else [])
                    if isinstance(annotation, dict) and annotation.get("type") != "message_ref_spans"
                ]
                existing_annotations.append({
                    "type": "message_ref_spans",
                    "count": len(ref_items),
                    "items": ref_items,
                })
                next_block["annotations"] = existing_annotations
                attached_any = True

        next_blocks.append(next_block)

    return next_blocks, attached_any
