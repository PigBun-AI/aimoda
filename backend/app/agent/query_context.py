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


_contexts: dict[str, QueryContext] = {}
_session_image_contexts: dict[str, QueryContext] = {}
_session_image_blocks: dict[str, list[dict]] = {}


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


def get_session_image_context(thread_id: str) -> QueryContext | None:
    return _session_image_contexts.get(thread_id)


def get_session_image_blocks(thread_id: str) -> list[dict]:
    return [dict(block) for block in _session_image_blocks.get(thread_id, [])]


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
