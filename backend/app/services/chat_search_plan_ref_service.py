from __future__ import annotations

import json
import re
from typing import Any

from langchain_core.messages import HumanMessage, SystemMessage

from ..config import settings
from ..llm_factory import build_llm_with_fallback
from ..value_normalization import normalize_quarter_value
from .chat_reference_service import build_search_plan_ref, extract_collection_result_payloads

SEARCH_PLAN_REF_MAX_TOKENS = 520


def _compact_text(value: Any) -> str:
    return " ".join(str(value or "").strip().split())


def _extract_text_content(value: Any) -> str:
    if isinstance(value, str):
        return _compact_text(value)
    if isinstance(value, list):
        parts: list[str] = []
        for item in value:
            if isinstance(item, str):
                parts.append(_compact_text(item))
            elif isinstance(item, dict) and isinstance(item.get("text"), str):
                parts.append(_compact_text(item.get("text")))
            else:
                text = getattr(item, "text", None)
                if isinstance(text, str):
                    parts.append(_compact_text(text))
        return "\n".join(part for part in parts if part)
    return _compact_text(value)


def _extract_text_blocks(blocks: list[dict[str, Any]]) -> list[tuple[int, dict[str, Any]]]:
    text_blocks: list[tuple[int, dict[str, Any]]] = []
    for index, block in enumerate(blocks):
        if isinstance(block, dict) and block.get("type") == "text" and str(block.get("text", "")).strip():
            text_blocks.append((index, block))
    return text_blocks


def _extract_collection_contexts(blocks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    payloads = extract_collection_result_payloads(blocks)
    contexts: list[dict[str, Any]] = []
    for payload in payloads[-3:]:
        filters = payload.get("filters_applied", [])
        normalized_filters = [
            str(item).strip()
            for item in filters
            if isinstance(filters, list) and str(item).strip()
        ] if isinstance(filters, list) else []
        contexts.append({
            "query": str(payload.get("query", "") or "").strip(),
            "filters_applied": normalized_filters,
            "total": int(payload.get("total", 0) or 0),
        })
    return contexts


def _extract_existing_ref_quotes(text_block: dict[str, Any]) -> list[str]:
    annotations = text_block.get("annotations")
    if not isinstance(annotations, list):
        return []
    quotes: list[str] = []
    for annotation in annotations:
        if not isinstance(annotation, dict) or annotation.get("type") != "message_ref_spans":
            continue
        for item in annotation.get("items", []):
            if isinstance(item, dict):
                quote = str(item.get("quote", "")).strip()
                if quote:
                    quotes.append(quote)
    return quotes


def _extract_plan_json(raw: str) -> list[dict[str, Any]] | None:
    if not raw:
        return None
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", raw, re.DOTALL)
        if not match:
            return None
        try:
            payload = json.loads(match.group(0))
        except json.JSONDecodeError:
            return None
    spans = payload.get("spans")
    return spans if isinstance(spans, list) else None


def _build_search_plan_ref_llm():
    return build_llm_with_fallback(
        temperature=0,
        max_tokens=SEARCH_PLAN_REF_MAX_TOKENS,
    )


def _invoke_search_plan_ref_llm(
    *,
    assistant_text: str,
    request_query_text: str,
    collection_contexts: list[dict[str, Any]],
    existing_quotes: list[str],
) -> list[dict[str, Any]] | None:
    if settings.ENV == "test" or not settings.LLM_API_KEY:
        return None

    model = _build_search_plan_ref_llm()
    response = model.invoke([
        SystemMessage(
            content=(
                "你是 aimoda 的搜索引用规划器。"
                "请从 assistant_text 中找出少量真正值得点击继续看图的推荐词/短语/句子。"
                "只有当这个词句代表一个新的检索方向，并且你能根据上下文构造成稳定的搜索计划时，才输出。"
                "不要给已经有结果入口的词句重复做 ref。"
                "不要泛化，不要把普通描述词都做成 ref。"
                "优先品牌、风格方向、特征导向、补充推荐句。"
                "输出 JSON："
                "{\"spans\":[{\"quote\":\"Akris 的连衣裙\",\"occurrence\":1,\"label\":\"Akris 连衣裙\",\"query\":\"red dress\",\"brand\":\"Akris\",\"categories\":[\"dress\"],\"quarter\":\"秋冬\"}]}"
                "quote 必须是 assistant_text 中原样出现的连续子串。"
                "如果没有可靠的新检索方向，返回 {\"spans\":[]}。"
            )
        ),
        HumanMessage(
            content=(
                f"assistant_text={json.dumps(assistant_text, ensure_ascii=False)}\n"
                f"user_request={json.dumps(request_query_text, ensure_ascii=False)}\n"
                f"existing_ref_quotes={json.dumps(existing_quotes, ensure_ascii=False)}\n"
                f"current_collection_contexts={json.dumps(collection_contexts, ensure_ascii=False)}\n"
                "要求：\n"
                "1. 生成的新计划应尽量承接当前检索语义，不要偏航。\n"
                "2. 如果推荐了品牌/风格方向，要尽量保留原需求中的品类与色彩语义。\n"
                "3. categories 只允许常见服装品类英文单词；quarter 只允许 早春/春夏/早秋/秋冬。\n"
                "4. 最多输出 3 个。"
            )
        ),
    ])

    return _extract_plan_json(_extract_text_content(getattr(response, "content", "")))


def _normalize_categories(raw: Any) -> list[str]:
    if isinstance(raw, list):
        values = raw
    elif raw in (None, ""):
        values = []
    else:
        values = [raw]
    return [str(item).strip().lower() for item in values if str(item).strip()]


def _find_nth_occurrence(text: str, needle: str, occurrence: int) -> tuple[int, int] | None:
    target = str(needle or "")
    if not target:
        return None
    cursor = 0
    remaining = max(1, int(occurrence or 1))
    while remaining > 0:
        index = text.find(target, cursor)
        if index < 0:
            return None
        remaining -= 1
        if remaining == 0:
            return index, index + len(target)
        cursor = index + len(target)
    return None


def _append_search_plan_span_annotations(
    *,
    block: dict[str, Any],
    session_id: str,
    spans: list[dict[str, Any]],
) -> dict[str, Any]:
    text = str(block.get("text", ""))
    if not text:
        return block

    annotations = block.get("annotations") if isinstance(block.get("annotations"), list) else []
    existing_span_items: list[dict[str, Any]] = []
    occupied: list[tuple[int, int]] = []

    for annotation in annotations:
        if not isinstance(annotation, dict) or annotation.get("type") != "message_ref_spans":
            continue
        items = annotation.get("items")
        if not isinstance(items, list):
            continue
        for item in items:
            if not isinstance(item, dict):
                continue
            quote = str(item.get("quote", "")).strip()
            occurrence = int(item.get("occurrence", 1) or 1)
            match_range = _find_nth_occurrence(text, quote, occurrence)
            if match_range:
                occupied.append(match_range)
            existing_span_items.append(dict(item))

    next_span_items = list(existing_span_items)
    for span in spans[:3]:
        if not isinstance(span, dict):
            continue
        quote = str(span.get("quote", "")).strip()
        occurrence = int(span.get("occurrence", 1) or 1)
        if len(quote) < 2:
            continue
        match_range = _find_nth_occurrence(text, quote, occurrence)
        if not match_range:
            continue
        start, end = match_range
        overlaps = any(start < existing_end and end > existing_start for existing_start, existing_end in occupied)
        if overlaps:
            continue

        label = str(span.get("label", "")).strip() or quote
        query = str(span.get("query", "")).strip()
        brand = str(span.get("brand", "")).strip() or None
        gender = str(span.get("gender", "")).strip().lower() or None
        quarter = normalize_quarter_value(span.get("quarter"))
        image_type = str(span.get("image_type", "")).strip() or None
        year_min_raw = span.get("year_min")
        try:
            year_min = int(year_min_raw) if year_min_raw not in (None, "") else None
        except (TypeError, ValueError):
            year_min = None
        categories = _normalize_categories(span.get("categories"))

        if not query and not brand:
            continue

        occupied.append((start, end))
        next_span_items.append({
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
            ),
        })

    if len(next_span_items) == len(existing_span_items):
        return block

    next_annotations = [
        dict(annotation)
        for annotation in annotations
        if not isinstance(annotation, dict) or annotation.get("type") != "message_ref_spans"
    ]
    next_annotations.append({
        "type": "message_ref_spans",
        "count": len(next_span_items),
        "items": next_span_items,
    })

    next_block = dict(block)
    next_block["annotations"] = next_annotations
    return next_block


def attach_search_plan_ref_spans(
    blocks: list[dict[str, Any]],
    *,
    session_id: str,
    request_query_text: str = "",
) -> list[dict[str, Any]]:
    if not blocks:
        return blocks

    next_blocks = [dict(block) if isinstance(block, dict) else block for block in blocks]
    collection_contexts = _extract_collection_contexts(blocks)
    if not collection_contexts and not str(request_query_text or "").strip():
        return next_blocks

    for index, block in _extract_text_blocks(next_blocks):
        assistant_text = str(block.get("text", "")).strip()
        existing_quotes = _extract_existing_ref_quotes(block)
        spans = _invoke_search_plan_ref_llm(
            assistant_text=assistant_text,
            request_query_text=request_query_text,
            collection_contexts=collection_contexts,
            existing_quotes=existing_quotes,
        )
        if not isinstance(spans, list) or not spans:
            continue
        next_blocks[index] = _append_search_plan_span_annotations(
            block=block,
            session_id=session_id,
            spans=spans,
        )

    return next_blocks
