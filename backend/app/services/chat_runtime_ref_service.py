from __future__ import annotations

import json
import re
from typing import Any

from ..agent.harness import infer_categories_from_text
from ..value_normalization import normalize_quarter_value
from .chat_reference_service import extract_collection_result_payloads
from .chat_structured_ref_service import strip_structured_ref_payload
from .chat_reference_service import build_search_plan_ref

_BRAND_PHRASE_RE = re.compile(r"^(?:[A-Z][A-Za-z0-9&'./-]*|[A-Z]{2,})(?:\s+(?:[A-Z][A-Za-z0-9&'./-]*|[A-Z]{2,})){0,3}$")
_BRAND_CUE_RE = re.compile(r"(?:特定品牌如|品牌如|品牌像|例如|比如)\s*([^。；!\n]+)")


def _parse_json_content(raw: Any) -> dict[str, Any] | None:
    if not isinstance(raw, str) or not raw:
        return None
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        return None
    return payload if isinstance(payload, dict) else None


def _extract_latest_style_payload(blocks: list[dict[str, Any]]) -> dict[str, Any] | None:
    for block in reversed(blocks):
        if not isinstance(block, dict) or block.get("type") != "tool_result":
            continue
        payload = _parse_json_content(block.get("content"))
        if not payload:
            continue
        if payload.get("primary_style") or payload.get("style_features"):
            return payload
    return None


def _extract_text_blocks(blocks: list[dict[str, Any]]) -> list[tuple[int, dict[str, Any]]]:
    return [
        (index, block)
        for index, block in enumerate(blocks)
        if isinstance(block, dict)
        and block.get("type") == "text"
        and str(block.get("text", "")).strip()
    ]


def _parse_filter_map(payload: dict[str, Any]) -> dict[str, str]:
    parsed: dict[str, str] = {}
    filters = payload.get("filters_applied")
    if not isinstance(filters, list):
        return parsed
    for item in filters:
        entry = str(item or "").strip()
        if "=" not in entry:
            continue
        key, value = entry.split("=", 1)
        parsed[key.strip().lower()] = value.strip()
    return parsed


def _grounded_brand_candidates(
    *,
    blocks: list[dict[str, Any]],
    collection_payload: dict[str, Any] | None,
) -> list[str]:
    brands: list[str] = []

    if collection_payload:
        sample_images = collection_payload.get("sample_images")
        if isinstance(sample_images, list):
            for item in sample_images:
                if not isinstance(item, dict):
                    continue
                brand = str(item.get("brand", "") or "").strip()
                if brand:
                    brands.append(brand)

    style_payload = _extract_latest_style_payload(blocks)
    if style_payload:
        features = style_payload.get("style_features")
        if isinstance(features, dict):
            references = features.get("reference_brands")
            if isinstance(references, list):
                for item in references:
                    brand = str(item or "").strip()
                    if brand:
                        brands.append(brand)

    seen: set[str] = set()
    deduped: list[str] = []
    for brand in brands:
        key = brand.casefold()
        if key in seen:
            continue
        seen.add(key)
        deduped.append(brand)
    return deduped


def _normalize_brand_candidate(value: Any) -> str:
    return str(value or "").strip().strip("：:;,.，。()（）[]{}<>")


def _looks_like_brand_candidate(value: str) -> bool:
    candidate = _normalize_brand_candidate(value)
    if len(candidate) < 2 or len(candidate) > 64:
        return False
    return bool(_BRAND_PHRASE_RE.fullmatch(candidate))


def _extract_explicit_brand_candidates(text: str) -> list[str]:
    candidates: list[str] = []
    cue_markers = ("特定品牌如", "品牌如", "品牌像", "例如", "比如")

    for match in re.finditer(r"\*\*([^*]+)\*\*", text):
        candidate = _normalize_brand_candidate(match.group(1))
        if _looks_like_brand_candidate(candidate):
            candidates.append(candidate)

    for match in _BRAND_CUE_RE.finditer(text):
        segment = match.group(1)
        for marker in cue_markers:
            marker_index = segment.rfind(marker)
            if marker_index > 0:
                segment = segment[marker_index + len(marker):]
                break
        segment = re.split(r"(?:，|\s)(?:或者|或是|以及|并且)", segment, maxsplit=1)[0]
        segment = re.split(r"(?:\s+的\b)|(?:\s+风格\b)|(?:\s+方向\b)|(?:\s+造型\b)", segment, maxsplit=1)[0]
        for part in re.split(r"\s+或\s+|、|，|,|/|\band\b", segment):
            candidate = _normalize_brand_candidate(part)
            if _looks_like_brand_candidate(candidate):
                candidates.append(candidate)

    deduped: list[str] = []
    seen: set[str] = set()
    for candidate in candidates:
        key = candidate.casefold()
        if key in seen:
            continue
        seen.add(key)
        deduped.append(candidate)
    return deduped


def _find_quote_occurrence(text: str, quote: str, occupied: list[tuple[int, int]]) -> tuple[str, int] | None:
    occurrence = 0
    cursor = 0
    normalized_text = text.casefold()
    normalized_quote = quote.casefold()
    while True:
        index = normalized_text.find(normalized_quote, cursor)
        if index < 0:
            return None
        occurrence += 1
        end = index + len(quote)
        overlaps = any(index < occupied_end and end > occupied_start for occupied_start, occupied_end in occupied)
        if not overlaps:
            occupied.append((index, end))
            return text[index:end], occurrence
        cursor = end


def attach_runtime_brand_refs(
    blocks: list[dict[str, Any]],
    *,
    session_id: str,
    request_query_text: str = "",
) -> tuple[list[dict[str, Any]], bool]:
    if not blocks:
        return blocks, False

    collection_payloads = extract_collection_result_payloads(blocks)
    collection_payload = collection_payloads[-1] if collection_payloads else None
    grounded_brands = _grounded_brand_candidates(blocks=blocks, collection_payload=collection_payload)

    filter_map = _parse_filter_map(collection_payload or {})
    current_brand = str(filter_map.get("brand", "") or "").strip()
    gender = str(filter_map.get("gender", "") or "").strip().lower() or None
    quarter = normalize_quarter_value(filter_map.get("quarter"))
    year_min = None
    year_min_raw = filter_map.get("year_min")
    if year_min_raw not in (None, ""):
        try:
            year_min = int(year_min_raw)
        except (TypeError, ValueError):
            year_min = None

    categories: list[str] = []
    category_value = str(filter_map.get("category", "") or "").strip().lower()
    if category_value:
        categories.append(category_value)
    else:
        categories.extend(infer_categories_from_text(request_query_text))
    categories = list(dict.fromkeys([item for item in categories if item]))

    semantic_query = str((collection_payload or {}).get("query", "") or "").strip() or str(request_query_text or "").strip()
    if not semantic_query:
        return blocks, False

    next_blocks = [dict(block) if isinstance(block, dict) else block for block in blocks]
    attached_any = False

    for index, block in _extract_text_blocks(next_blocks):
        text = strip_structured_ref_payload(str(block.get("text", "") or ""))
        brand_candidates = list(grounded_brands)
        for candidate in _extract_explicit_brand_candidates(text):
            if candidate.casefold() not in {brand.casefold() for brand in brand_candidates}:
                brand_candidates.append(candidate)
        if not brand_candidates:
            continue
        existing_annotations = block.get("annotations") if isinstance(block.get("annotations"), list) else []
        occupied: list[tuple[int, int]] = []
        existing_span_items: list[dict[str, Any]] = []

        for annotation in existing_annotations:
            if not isinstance(annotation, dict) or annotation.get("type") != "message_ref_spans":
                continue
            items = annotation.get("items")
            if not isinstance(items, list):
                continue
            for item in items:
                if not isinstance(item, dict):
                    continue
                quote = str(item.get("quote", "") or "").strip()
                occurrence = int(item.get("occurrence", 1) or 1)
                cursor = 0
                count = 0
                while True:
                    found = text.find(quote, cursor)
                    if found < 0:
                        break
                    count += 1
                    end = found + len(quote)
                    if count == occurrence:
                        occupied.append((found, end))
                        break
                    cursor = end
                existing_span_items.append(dict(item))

        next_items = list(existing_span_items)

        for brand in brand_candidates:
            if current_brand and brand.casefold() == current_brand.casefold():
                continue
            candidate_phrases = [
                f"{brand} 的",
                brand,
            ]
            match: tuple[str, int] | None = None
            for phrase in candidate_phrases:
                match = _find_quote_occurrence(text, phrase, occupied)
                if match:
                    break
            if not match:
                continue

            quote, occurrence = match
            label = f"{brand} {categories[0].title()}" if len(categories) == 1 else brand
            next_items.append({
                "quote": quote,
                "occurrence": occurrence,
                "label": label,
                "target": build_search_plan_ref(
                    session_id=session_id,
                    label=label,
                    query=semantic_query,
                    categories=categories,
                    brand=brand,
                    gender=gender,
                    quarter=quarter,
                    year_min=year_min,
                    source="runtime_brand_ref",
                ),
            })

        if len(next_items) == len(existing_span_items):
            continue

        next_block = dict(block)
        next_block["text"] = text
        next_block["annotations"] = [
            dict(annotation)
            for annotation in existing_annotations
            if not isinstance(annotation, dict) or annotation.get("type") != "message_ref_spans"
        ] + [{
            "type": "message_ref_spans",
            "count": len(next_items),
            "items": next_items,
        }]
        next_blocks[index] = next_block
        attached_any = True

    return next_blocks, attached_any
