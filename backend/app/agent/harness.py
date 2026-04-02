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
    session_categories: list[str]
    primary_category: str
    active_skill: str
    request_mode: str
    invalid_filter_attempts: dict[str, int]


_turn_contexts: dict[str, TurnContext] = {}
_session_semantics: dict[str, dict[str, str]] = {}


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
    session_filters: list[dict] | None = None,
    session_active: bool = False,
    session_primary_category: str | None = None,
) -> TurnContext:
    inferred_categories = infer_categories_from_text(query_text)
    session_categories = infer_categories_from_filters(session_filters)
    primary_candidates = session_categories or ([session_primary_category] if session_primary_category else []) or inferred_categories
    primary_category = primary_candidates[0] if len(primary_candidates) == 1 else ""
    return {
        "query_text": query_text,
        "has_images": has_images,
        "inferred_categories": inferred_categories,
        "session_categories": session_categories,
        "primary_category": primary_category,
        "active_skill": "multimodal_retrieval" if has_images else "text_retrieval",
        "request_mode": "refine_existing_collection" if session_active else "new_search",
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


def get_session_semantics(thread_id: str) -> dict[str, str]:
    return dict(_session_semantics.get(thread_id, {}))


def set_session_semantics(thread_id: str, semantics: dict[str, str] | None) -> None:
    if not semantics:
        _session_semantics.pop(thread_id, None)
        return
    _session_semantics[thread_id] = {
        str(key): str(value)
        for key, value in semantics.items()
        if isinstance(key, str) and isinstance(value, str) and value.strip()
    }


def update_session_semantics(
    *,
    thread_id: str,
    query_text: str = "",
    session_filters: list[dict] | None = None,
    explicit_category: str | None = None,
) -> dict[str, str]:
    current = dict(_session_semantics.get(thread_id, {}))

    candidate_categories: list[str] = []
    if explicit_category and explicit_category.strip():
        candidate_categories.append(explicit_category.strip().lower())
    candidate_categories.extend(infer_categories_from_filters(session_filters))
    candidate_categories.extend(infer_categories_from_text(query_text))
    candidate_categories = list(dict.fromkeys(candidate_categories))

    if len(candidate_categories) == 1:
        current["primary_category"] = candidate_categories[0]
    if query_text.strip():
        current["last_query_text"] = query_text.strip()

    _session_semantics[thread_id] = current
    return dict(current)


def infer_categories_from_filters(session_filters: list[dict] | None) -> list[str]:
    found: list[str] = []
    for item in (session_filters or []):
        item_type = item.get("type")
        if item_type == "category":
            value = str(item.get("value", "")).strip().lower()
            if value:
                found.append(value)
            continue

        if item_type in {"garment_tag", "garment_attr"}:
            key = str(item.get("key", "")).strip().lower()
            if ":" in key:
                category = key.split(":", 1)[0].strip()
                if category:
                    found.append(category)

    return list(dict.fromkeys(found))


def infer_active_category(
    *,
    thread_id: str,
    session_filters: list[dict] | None,
) -> str | None:
    filter_categories = infer_categories_from_filters(session_filters)
    if len(filter_categories) == 1:
        return filter_categories[0]

    session_semantics = get_session_semantics(thread_id)
    session_primary_category = session_semantics.get("primary_category", "").strip().lower()
    if session_primary_category:
        return session_primary_category

    context = get_turn_context(thread_id)
    if context:
        primary_category = context.get("primary_category", "").strip().lower()
        if primary_category:
            return primary_category

        inferred = context.get("inferred_categories", [])
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
    primary_category = context.get("primary_category", "")

    if context.get("has_images"):
        lines = [
            "[TURN_PROTOCOL]",
            "skill=multimodal_retrieval",
            "state_changing_tools_serial_only=true",
            "same_failed_call_retry=forbidden",
            "style_discovery_tool=search_style",
            "image_understanding_tool=fashion_vision",
            "plan_order=fashion_vision -> start_collection -> add_filter -> show_collection",
        ]
    else:
        lines = [
            "[TURN_PROTOCOL]",
            "skill=text_retrieval",
            "state_changing_tools_serial_only=true",
            "same_failed_call_retry=forbidden",
            "style_discovery_tool=search_style",
            "garment_attribute_requires_category=true",
            "plan_order=start_collection -> add_filter -> show_collection",
        ]

    if context.get("request_mode") == "refine_existing_collection":
        lines.append("request_mode=refine_existing_collection")
        lines.append("prefer_refining_current_collection=true")
        lines.append("restart_collection_only_if_current_pool_is_off_target=true")

    lines.append("abstract_style_requires_translation=true")
    lines.append("abstract_style_prefers_search_style_tool=true")
    lines.append("unsupported_filter_dimensions=style,mood,vibe")

    if primary_category:
        lines.append(f"inferred_primary_category={primary_category}")
        lines.append(
            f"garment_attribute_default_category={primary_category}"
        )
        lines.append(
            f"recommended_next_filters=category:{primary_category} before garment attributes if session has no category yet"
        )

    return "\n".join(lines)
