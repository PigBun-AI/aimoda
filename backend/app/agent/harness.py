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


def build_turn_playbook(context: TurnContext) -> str:
    """Create a compact turn-specific protocol, similar to an on-demand skill."""
    categories = context.get("inferred_categories", [])
    category_hint = f"当前文本已隐含主品类：{categories[0]}。" if len(categories) == 1 else ""

    if context.get("has_images"):
        lines = [
            "[ACTIVE PLAYBOOK: multimodal_retrieval]",
            "- 这是图像参与的检索轮次，先理解图片，再收缩筛选。",
            "- 若需要图片理解，优先调用 fashion_vision。",
            "- 不要并行调用多个会改变集合状态的工具。",
            "- 工具报错后，先修正参数或换策略，不要重复相同调用。",
        ]
    else:
        lines = [
            "[ACTIVE PLAYBOOK: text_retrieval]",
            "- 这是纯文本检索轮次，先抽取主品类，再逐步增加最关键的过滤条件。",
            "- 不要并行调用多个会改变集合状态的工具（start_collection/add_filter/remove_filter）。",
            "- garment attribute（如 color/fabric/pattern/silhouette/collar）必须依附某个 category。",
            "- 工具报错后，先修正参数或换策略，不要重复相同调用。",
        ]

    if category_hint:
        lines.append(f"- {category_hint} 对应 garment attribute 默认优先绑定到这个品类。")

    return "\n".join(lines)
