"""
Lightweight runtime harness for turn-level retrieval guidance.

This module keeps the core agent prompt small while injecting the minimum
turn-specific protocol needed to avoid unstable tool usage.
"""

from __future__ import annotations

from typing import TypedDict


class TurnContext(TypedDict, total=False):
    query_text: str
    has_images: bool
    inferred_categories: list[str]
    active_skill: str
    invalid_filter_attempts: dict[str, int]


_turn_contexts: dict[str, TurnContext] = {}


_CATEGORY_ALIASES: dict[str, tuple[str, ...]] = {
    "dress": ("连衣裙", "裙装", "裙子", "dress", "gown"),
    "skirt": ("半身裙", "skirt"),
    "jacket": ("夹克", "外套", "西装外套", "jacket", "blazer"),
    "coat": ("大衣", "风衣", "coat", "trench"),
    "shirt": ("衬衫", "shirt", "blouse"),
    "sweater": ("毛衣", "针织", "sweater", "knit"),
    "trousers": ("裤子", "长裤", "西裤", "trousers", "pants"),
    "boots": ("靴", "boots"),
    "heels": ("高跟鞋", "heels", "pump"),
}


def infer_categories_from_text(text: str) -> list[str]:
    normalized = text.strip().lower()
    if not normalized:
        return []

    found: list[str] = []
    for category, aliases in _CATEGORY_ALIASES.items():
        if any(alias.lower() in normalized for alias in aliases):
            found.append(category)

    # Preserve definition order while de-duplicating.
    return list(dict.fromkeys(found))


def build_turn_context(
    *,
    query_text: str,
    has_images: bool,
) -> TurnContext:
    inferred_categories = infer_categories_from_text(query_text)
    return {
        "query_text": query_text,
        "has_images": has_images,
        "inferred_categories": inferred_categories,
        "active_skill": "multimodal_retrieval" if has_images else "text_retrieval",
        "invalid_filter_attempts": {},
    }


def set_turn_context(thread_id: str, context: TurnContext | None) -> None:
    if not context:
        _turn_contexts.pop(thread_id, None)
        return
    _turn_contexts[thread_id] = context


def get_turn_context(thread_id: str) -> TurnContext | None:
    return _turn_contexts.get(thread_id)


def clear_turn_context(thread_id: str) -> None:
    _turn_contexts.pop(thread_id, None)


def infer_active_category(
    *,
    thread_id: str,
    session_filters: list[dict] | None,
) -> str | None:
    category_values = {
        str(item.get("value", "")).lower()
        for item in (session_filters or [])
        if item.get("type") == "category" and str(item.get("value", "")).strip()
    }
    if len(category_values) == 1:
        return next(iter(category_values))

    context = get_turn_context(thread_id)
    inferred = context.get("inferred_categories", []) if context else []
    if len(inferred) == 1:
        return inferred[0]

    return None


def build_filter_signature(
    *,
    dimension: str,
    value: str,
    category: str | None,
) -> str:
    normalized_category = (category or "").strip().lower() or "__missing__"
    return f"{dimension.strip().lower()}::{value.strip().lower()}::{normalized_category}"


def note_invalid_filter_attempt(
    *,
    thread_id: str,
    dimension: str,
    value: str,
    category: str | None,
) -> int:
    context = _turn_contexts.setdefault(thread_id, {})
    attempts = context.setdefault("invalid_filter_attempts", {})
    signature = build_filter_signature(dimension=dimension, value=value, category=category)
    attempts[signature] = attempts.get(signature, 0) + 1
    return attempts[signature]


def clear_invalid_filter_attempt(
    *,
    thread_id: str,
    dimension: str,
    value: str,
    category: str | None,
) -> None:
    context = _turn_contexts.get(thread_id)
    if not context:
        return
    attempts = context.get("invalid_filter_attempts")
    if not attempts:
        return
    signature = build_filter_signature(dimension=dimension, value=value, category=category)
    attempts.pop(signature, None)


def build_turn_playbook(context: TurnContext) -> str:
    """Create a compact turn-specific protocol, similar to an on-demand skill."""
    categories = context.get("inferred_categories", [])
    primary_category = categories[0] if len(categories) == 1 else ""

    if context.get("has_images"):
        lines = [
            "[TURN_PROTOCOL]",
            "skill=multimodal_retrieval",
            "state_changing_tools_serial_only=true",
            "same_failed_call_retry=forbidden",
            "image_understanding_tool=fashion_vision",
            "plan_order=fashion_vision -> start_collection -> add_filter -> show_collection",
        ]
    else:
        lines = [
            "[TURN_PROTOCOL]",
            "skill=text_retrieval",
            "state_changing_tools_serial_only=true",
            "same_failed_call_retry=forbidden",
            "garment_attribute_requires_category=true",
            "plan_order=start_collection -> add_filter -> show_collection",
        ]

    if primary_category:
        lines.append(f"inferred_primary_category={primary_category}")
        lines.append(
            f"garment_attribute_default_category={primary_category}"
        )
        lines.append(
            f"recommended_next_filters=category:{primary_category} before garment attributes if session has no category yet"
        )

    return "\n".join(lines)
