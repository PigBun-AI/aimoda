from __future__ import annotations

import json
import logging
import re
from typing import Any

from langchain_core.messages import HumanMessage, SystemMessage

from ..config import settings
from ..llm_factory import build_llm_with_fallback

logger = logging.getLogger(__name__)

REF_SPAN_MAX_TOKENS = 320
_NON_EMPTY_TEXT_RE = re.compile(r"\S+")


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


def _find_nth_occurrence(text: str, needle: str, occurrence: int) -> tuple[int, int] | None:
    target = str(needle or "")
    if not target:
        return None
    next_start = 0
    remaining = max(1, int(occurrence or 1))
    while remaining > 0:
        index = text.find(target, next_start)
        if index < 0:
            return None
        remaining -= 1
        if remaining == 0:
            return index, index + len(target)
        next_start = index + len(target)
    return None


def _find_phrase_occurrence(
    text: str,
    phrase: str,
    *,
    occupied: list[tuple[int, int]],
) -> tuple[str, int, int, int] | None:
    normalized_phrase = str(phrase or "").strip()
    if len(normalized_phrase) < 2:
        return None

    occurrence = 0
    next_start = 0
    while True:
        index = text.find(normalized_phrase, next_start)
        if index < 0:
            return None
        occurrence += 1
        end = index + len(normalized_phrase)
        overlaps = any(index < existing_end and end > existing_start for existing_start, existing_end in occupied)
        if not overlaps:
            return normalized_phrase, occurrence, index, end
        next_start = end


def _fallback_select_ref_spans(text: str, items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    selected: list[dict[str, Any]] = []
    occupied: list[tuple[int, int]] = []

    for item in items:
        target = item.get("target")
        if not isinstance(target, dict):
            continue
        phrases = item.get("phrases")
        if not isinstance(phrases, list):
            continue
        for phrase in phrases:
            candidate = _find_phrase_occurrence(text, str(phrase or ""), occupied=occupied)
            if not candidate:
                continue
            quote, occurrence, start, end = candidate
            occupied.append((start, end))
            selected.append({
                "quote": quote,
                "occurrence": occurrence,
                "label": str(item.get("label", "")).strip() or quote,
                "target": target,
            })
            break

    return selected


def _build_ref_linker_llm():
    return build_llm_with_fallback(
        temperature=0,
        max_tokens=REF_SPAN_MAX_TOKENS,
    )


def _invoke_ref_linker_model(text: str, items: list[dict[str, Any]]) -> list[dict[str, Any]] | None:
    if settings.ENV == "test" or not settings.LLM_API_KEY:
        return None

    model = _build_ref_linker_llm()
    candidate_lines: list[str] = []
    for index, item in enumerate(items, start=1):
        label = str(item.get("label", "")).strip() or f"结果 {index}"
        phrases = [str(phrase).strip() for phrase in item.get("phrases", []) if str(phrase).strip()]
        candidate_lines.append(
            f"{index}. label={label}; phrases={json.dumps(phrases[:8], ensure_ascii=False)}"
        )

    response = model.invoke([
        SystemMessage(
            content=(
                "你是 aimoda 的消息引用链接规划器。"
                "你的任务是：只在助手最终回复中，选择那些真正有依据、值得用户点击展开更多图的词或短语。"
                "不要把所有名词都做成 ref；只有当该词/短语明确对应候选结果集时，才可以选择。"
                "必须克制，宁缺毋滥。"
                "输出 JSON：{\"spans\":[{\"item_index\":1,\"quote\":\"...\",\"occurrence\":1}]}"
                "quote 必须是 assistant_text 中原样出现的连续子串。"
                "如果没有可靠可点内容，返回 {\"spans\":[]}。"
            )
        ),
        HumanMessage(
            content=(
                f"assistant_text={json.dumps(text, ensure_ascii=False)}\n"
                f"candidate_refs=\n" + "\n".join(candidate_lines)
            )
        ),
    ])
    raw = _extract_text_content(getattr(response, "content", ""))
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


def _materialize_selected_spans(
    text: str,
    items: list[dict[str, Any]],
    selected_spans: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    valid: list[dict[str, Any]] = []
    occupied: list[tuple[int, int]] = []

    for span in selected_spans:
        if not isinstance(span, dict):
            continue
        try:
            item_index = int(span.get("item_index", 0))
        except (TypeError, ValueError):
            continue
        if item_index < 1 or item_index > len(items):
            continue
        item = items[item_index - 1]
        quote = str(span.get("quote", "")).strip()
        occurrence = int(span.get("occurrence", 1) or 1)
        if len(quote) < 2:
            continue

        matched_range = _find_nth_occurrence(text, quote, occurrence)
        if not matched_range:
            continue
        start, end = matched_range
        overlaps = any(start < existing_end and end > existing_start for existing_start, existing_end in occupied)
        if overlaps:
            continue

        phrases = [str(phrase).strip() for phrase in item.get("phrases", []) if str(phrase).strip()]
        grounded = any(
            phrase.casefold() in quote.casefold() or quote.casefold() in phrase.casefold()
            for phrase in phrases
        )
        if not grounded:
            continue

        occupied.append((start, end))
        valid.append({
            "quote": quote,
            "occurrence": occurrence,
            "label": str(item.get("label", "")).strip() or quote,
            "target": item.get("target"),
        })

    return valid


def _build_message_ref_span_annotation(items: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "type": "message_ref_spans",
        "count": len(items),
        "items": items,
    }


def attach_message_ref_spans(blocks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not blocks:
        return blocks

    next_blocks = [dict(block) if isinstance(block, dict) else block for block in blocks]

    for index, block in enumerate(next_blocks):
        if not isinstance(block, dict) or block.get("type") != "text":
            continue
        text = str(block.get("text", ""))
        if not _NON_EMPTY_TEXT_RE.search(text):
            continue

        annotations = block.get("annotations")
        if not isinstance(annotations, list):
            continue
        message_ref_annotation = next(
            (
                annotation
                for annotation in annotations
                if isinstance(annotation, dict)
                and annotation.get("type") == "message_refs"
                and isinstance(annotation.get("items"), list)
            ),
            None,
        )
        if not isinstance(message_ref_annotation, dict):
            continue

        ref_items = [dict(item) for item in message_ref_annotation.get("items", []) if isinstance(item, dict)]
        if not ref_items:
            continue

        llm_selection = _invoke_ref_linker_model(text, ref_items)
        selected_items = (
            _materialize_selected_spans(text, ref_items, llm_selection)
            if isinstance(llm_selection, list)
            else []
        )
        if not selected_items:
            selected_items = _fallback_select_ref_spans(text, ref_items)
        if not selected_items:
            continue

        next_annotations = [
            dict(annotation)
            for annotation in annotations
            if isinstance(annotation, dict) and annotation.get("type") != "message_ref_spans"
        ]
        next_annotations.append(_build_message_ref_span_annotation(selected_items))
        next_block = dict(block)
        next_block["annotations"] = next_annotations
        next_blocks[index] = next_block

    return next_blocks

