"""
Per-thread multimodal query context.

Stores transient query assets derived from the latest user turn, such as
uploaded image embeddings. Tools can read this context during the same turn
without forcing large payloads into the model-visible tool arguments.
"""

from __future__ import annotations

import math
from typing import TypedDict


class QueryContext(TypedDict, total=False):
    image_embeddings: list[list[float]]
    image_count: int
    style_retrieval_query: str
    style_rich_text: str
    style_name: str
    vision_retrieval_query: str
    vision_summary_zh: str
    vision_primary_category: str


_contexts: dict[str, QueryContext] = {}
_session_image_contexts: dict[str, QueryContext] = {}
_session_image_blocks: dict[str, list[dict]] = {}
_session_style_contexts: dict[str, QueryContext] = {}
_session_vision_contexts: dict[str, QueryContext] = {}


def set_query_context(thread_id: str, context: QueryContext | None) -> None:
    if not context:
        _contexts.pop(thread_id, None)
        return
    _contexts[thread_id] = context


def get_query_context(thread_id: str) -> QueryContext | None:
    return _contexts.get(thread_id)


def remember_session_images(
    thread_id: str,
    *,
    image_blocks: list[dict],
    context: QueryContext,
) -> None:
    """Persist the latest uploaded image context for follow-up turns."""
    _session_image_contexts[thread_id] = {
        "image_embeddings": [list(vector) for vector in context.get("image_embeddings", [])],
        "image_count": int(context.get("image_count", len(context.get("image_embeddings", [])))),
    }
    _session_image_blocks[thread_id] = [dict(block) for block in image_blocks]


def remember_session_style(
    thread_id: str,
    *,
    style_retrieval_query: str,
    style_rich_text: str = "",
    style_name: str = "",
) -> None:
    context: QueryContext = {}
    if style_retrieval_query.strip():
        context["style_retrieval_query"] = style_retrieval_query.strip()
    if style_rich_text.strip():
        context["style_rich_text"] = style_rich_text.strip()
    if style_name.strip():
        context["style_name"] = style_name.strip()

    if context:
        _session_style_contexts[thread_id] = context


def remember_session_vision(
    thread_id: str,
    *,
    vision_retrieval_query: str,
    vision_summary_zh: str = "",
    vision_primary_category: str = "",
) -> None:
    context: QueryContext = {}
    if vision_retrieval_query.strip():
        context["vision_retrieval_query"] = vision_retrieval_query.strip()
    if vision_summary_zh.strip():
        context["vision_summary_zh"] = vision_summary_zh.strip()
    if vision_primary_category.strip():
        context["vision_primary_category"] = vision_primary_category.strip().lower()

    if context:
        _session_vision_contexts[thread_id] = context


def get_session_image_context(thread_id: str) -> QueryContext | None:
    return _session_image_contexts.get(thread_id)


def get_session_image_blocks(thread_id: str) -> list[dict]:
    return [dict(block) for block in _session_image_blocks.get(thread_id, [])]


def get_session_style_context(thread_id: str) -> QueryContext | None:
    return _session_style_contexts.get(thread_id)


def get_session_vision_context(thread_id: str) -> QueryContext | None:
    return _session_vision_contexts.get(thread_id)


def merge_query_contexts(*contexts: QueryContext | None) -> QueryContext | None:
    merged: QueryContext = {}
    for context in contexts:
        if not context:
            continue
        if context.get("image_embeddings"):
            merged["image_embeddings"] = [list(vector) for vector in context.get("image_embeddings", [])]
        if context.get("image_count") is not None:
            merged["image_count"] = int(context.get("image_count", 0))
        if context.get("style_retrieval_query"):
            merged["style_retrieval_query"] = str(context.get("style_retrieval_query", "")).strip()
        if context.get("style_rich_text"):
            merged["style_rich_text"] = str(context.get("style_rich_text", "")).strip()
        if context.get("style_name"):
            merged["style_name"] = str(context.get("style_name", "")).strip()
        if context.get("vision_retrieval_query"):
            merged["vision_retrieval_query"] = str(context.get("vision_retrieval_query", "")).strip()
        if context.get("vision_summary_zh"):
            merged["vision_summary_zh"] = str(context.get("vision_summary_zh", "")).strip()
        if context.get("vision_primary_category"):
            merged["vision_primary_category"] = str(context.get("vision_primary_category", "")).strip().lower()
    return merged or None


def get_session_query_context(thread_id: str) -> QueryContext | None:
    return merge_query_contexts(
        get_session_image_context(thread_id),
        get_session_style_context(thread_id),
        get_session_vision_context(thread_id),
    )


def average_embeddings(vectors: list[list[float]]) -> list[float] | None:
    """Normalize the arithmetic mean of multiple same-sized embeddings."""
    if not vectors:
        return None

    length = len(vectors[0])
    if length == 0:
        return None

    avg = [0.0] * length
    for vector in vectors:
        if len(vector) != length:
            return None
        for index, value in enumerate(vector):
            avg[index] += value

    count = float(len(vectors))
    avg = [value / count for value in avg]
    norm = math.sqrt(sum(value * value for value in avg))
    if norm < 1e-9:
        return avg
    return [value / norm for value in avg]
