"""
Lightweight runtime harness for turn-level retrieval guidance.

This module keeps the core agent prompt small while injecting the minimum
turn-specific protocol needed to avoid unstable tool usage.
"""

from __future__ import annotations

from typing import Any, TypedDict

from ..value_normalization import (
    expand_season_groups_to_quarters,
    normalize_image_type_list,
    normalize_quarter_list,
    normalize_site_list,
    normalize_year_list,
)


class TurnContext(TypedDict, total=False):
    query_text: str
    has_images: bool
    inferred_categories: list[str]
    session_categories: list[str]
    primary_category: str
    brand_only_request: bool
    active_skill: str
    request_mode: str
    invalid_filter_attempts: dict[str, int]


class RuntimeHardFilter(TypedDict, total=False):
    dimension: str
    value: str | int | list[str] | list[int]
    source: str
    category: str


class RuntimePlan(TypedDict, total=False):
    goal_type: str
    search_strategy: str
    default_category: str
    hard_filters: list[RuntimeHardFilter]
    soft_cues: list[str]
    policy_flags: dict[str, bool]
    next_step_hint: str
    blocked_tools: list[str]


class IntentBrief(TypedDict, total=False):
    user_goal: str
    retrieval_intent: str
    collection_mode: str
    preferred_tool_sequence: list[str]
    required_preconditions: list[str]
    tool_constraints: list[str]
    execution_notes: list[str]


class PlannerFrame(TypedDict, total=False):
    schema_version: str
    current_stage: str
    next_action: str
    allowed_tools: list[str]
    disallowed_tools: list[str]
    completion_gate: str
    planning_notes: list[str]


_turn_contexts: dict[str, TurnContext] = {}
_session_semantics: dict[str, dict[str, str]] = {}
_runtime_plans: dict[str, RuntimePlan] = {}


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


def infer_brand_only_request(text: str) -> bool:
    normalized = text.strip().lower()
    if not normalized:
        return False

    exclusivity_markers = ("只看", "只要", "仅看", "只需", "只想看", "only", "just")
    brand_markers = ("品牌", "牌子", "brand")

    has_exclusivity = any(marker in normalized for marker in exclusivity_markers)
    has_brand_marker = any(marker in normalized for marker in brand_markers)

    return has_exclusivity and has_brand_marker


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
        "brand_only_request": infer_brand_only_request(query_text),
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


def get_runtime_plan(thread_id: str) -> RuntimePlan | None:
    plan = _runtime_plans.get(thread_id)
    if not plan:
        return None
    return {
        "goal_type": str(plan.get("goal_type", "")),
        "search_strategy": str(plan.get("search_strategy", "")),
        "default_category": str(plan.get("default_category", "")),
        "hard_filters": [dict(item) for item in plan.get("hard_filters", []) if isinstance(item, dict)],
        "soft_cues": [str(item) for item in plan.get("soft_cues", []) if str(item).strip()],
        "policy_flags": {
            str(key): bool(value)
            for key, value in (plan.get("policy_flags", {}) or {}).items()
            if isinstance(key, str)
        },
        "next_step_hint": str(plan.get("next_step_hint", "")).strip(),
        "blocked_tools": [str(item).strip() for item in plan.get("blocked_tools", []) if str(item).strip()],
    }


def set_runtime_plan(thread_id: str, plan: RuntimePlan | None) -> None:
    if not plan:
        _runtime_plans.pop(thread_id, None)
        return
    _runtime_plans[thread_id] = get_runtime_plan_from_payload(plan)


def clear_runtime_plan(thread_id: str) -> None:
    _runtime_plans.pop(thread_id, None)


def get_runtime_plan_from_payload(payload: dict[str, Any] | RuntimePlan | None) -> RuntimePlan:
    raw_plan = payload if isinstance(payload, dict) else {}
    hard_filters: list[RuntimeHardFilter] = []
    for item in raw_plan.get("hard_filters", []) if isinstance(raw_plan.get("hard_filters"), list) else []:
        if not isinstance(item, dict):
            continue
        dimension = str(item.get("dimension", "")).strip().lower()
        value = item.get("value")
        if not dimension or value in (None, ""):
            continue
        normalized_value: str | int | list[str] | list[int] = value
        if dimension == "quarter":
            quarters = normalize_quarter_list(value)
            if not quarters:
                continue
            normalized_value = quarters[0] if len(quarters) == 1 else quarters
        elif dimension == "year":
            years = normalize_year_list(value)
            if not years:
                continue
            normalized_value = years[0] if len(years) == 1 else years
        elif dimension == "year_min":
            try:
                normalized_value = int(value)
            except (TypeError, ValueError):
                continue
        elif dimension == "source_site":
            sites = normalize_site_list(value)
            if not sites:
                continue
            normalized_value = sites[0] if len(sites) == 1 else sites
        elif dimension == "image_type":
            image_types = normalize_image_type_list(value)
            if not image_types:
                continue
            normalized_value = image_types[0] if len(image_types) == 1 else image_types
        else:
            normalized_value = str(value).strip().lower() if dimension in {"category", "gender", "brand"} else str(value).strip()
            if normalized_value == "":
                continue
        normalized: RuntimeHardFilter = {
            "dimension": dimension,
            "value": normalized_value,
            "source": str(item.get("source", "")).strip() or "runtime",
        }
        category = str(item.get("category", "")).strip().lower()
        if category:
            normalized["category"] = category
        if normalized not in hard_filters:
            hard_filters.append(normalized)

    soft_cues = [
        str(item).strip()
        for item in raw_plan.get("soft_cues", [])
        if str(item).strip()
    ] if isinstance(raw_plan.get("soft_cues"), list) else []

    policy_flags = {
        str(key): bool(value)
        for key, value in (raw_plan.get("policy_flags", {}) or {}).items()
        if isinstance(key, str)
    }

    return {
        "goal_type": str(raw_plan.get("goal_type", "")).strip() or "semantic_browse",
        "search_strategy": str(raw_plan.get("search_strategy", "")).strip() or "semantic_browse",
        "default_category": str(raw_plan.get("default_category", "")).strip().lower(),
        "hard_filters": hard_filters,
        "soft_cues": soft_cues,
        "policy_flags": policy_flags,
        "next_step_hint": str(raw_plan.get("next_step_hint", "")).strip(),
        "blocked_tools": [
            str(item).strip()
            for item in raw_plan.get("blocked_tools", [])
            if str(item).strip()
        ] if isinstance(raw_plan.get("blocked_tools"), list) else [],
    }


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
    explicit_style_name: str | None = None,
    style_retrieval_query: str | None = None,
    style_rich_text: str | None = None,
    vision_retrieval_query: str | None = None,
    vision_summary_zh: str | None = None,
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
    if explicit_style_name and explicit_style_name.strip():
        current["primary_style_name"] = explicit_style_name.strip()
    if style_retrieval_query and style_retrieval_query.strip():
        current["style_retrieval_query"] = style_retrieval_query.strip()
    if style_rich_text and style_rich_text.strip():
        current["style_rich_text"] = style_rich_text.strip()
    if vision_retrieval_query and vision_retrieval_query.strip():
        current["vision_retrieval_query"] = vision_retrieval_query.strip()
    if vision_summary_zh and vision_summary_zh.strip():
        current["vision_summary_zh"] = vision_summary_zh.strip()
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

    runtime_plan = get_runtime_plan(thread_id) or {}
    default_category = str(runtime_plan.get("default_category", "")).strip().lower()
    if default_category:
        return default_category
    for hard_filter in runtime_plan.get("hard_filters", []):
        if str(hard_filter.get("dimension", "")).strip().lower() == "category":
            value = str(hard_filter.get("value", "")).strip().lower()
            if value:
                return value

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


def _append_runtime_hard_filter(
    hard_filters: list[RuntimeHardFilter],
    *,
    dimension: str,
    value: str | int | list[str] | list[int],
    source: str,
    category: str | None = None,
) -> None:
    normalized_dimension = dimension.strip().lower()
    if not normalized_dimension or value in ("", None):
        return

    normalized_value: str | int | list[str] | list[int] = value
    if normalized_dimension == "quarter":
        quarters = normalize_quarter_list(value)
        if not quarters:
            return
        normalized_value = quarters[0] if len(quarters) == 1 else quarters
    elif normalized_dimension == "year":
        years = normalize_year_list(value)
        if not years:
            return
        normalized_value = years[0] if len(years) == 1 else years
    elif normalized_dimension == "year_min":
        try:
            normalized_value = int(value)
        except (TypeError, ValueError):
            return
    elif normalized_dimension == "source_site":
        sites = normalize_site_list(value)
        if not sites:
            return
        normalized_value = sites[0] if len(sites) == 1 else sites
    elif normalized_dimension == "image_type":
        image_types = normalize_image_type_list(value)
        if not image_types:
            return
        normalized_value = image_types[0] if len(image_types) == 1 else image_types
    elif normalized_dimension in {"category", "gender", "brand"}:
        normalized_value = str(value).strip().lower()
    else:
        normalized_value = str(value).strip()

    if normalized_value in ("", None):
        return

    entry: RuntimeHardFilter = {
        "dimension": normalized_dimension,
        "value": normalized_value,
        "source": source,
    }
    normalized_category = (category or "").strip().lower()
    if normalized_category:
        entry["category"] = normalized_category

    if entry not in hard_filters:
        hard_filters.append(entry)


def _collect_stable_session_filters(session_filters: list[dict] | None) -> list[RuntimeHardFilter]:
    hard_filters: list[RuntimeHardFilter] = []
    for item in session_filters or []:
        item_type = str(item.get("type", "")).strip().lower()
        if item_type == "category":
            _append_runtime_hard_filter(
                hard_filters,
                dimension="category",
                value=str(item.get("value", "")),
                source="session_filter",
            )
            continue
        if item_type != "meta":
            continue
        key = str(item.get("key", "")).strip().lower()
        if key not in {"brand", "gender", "quarter", "year", "year_min", "image_type", "source_site"}:
            continue
        _append_runtime_hard_filter(
            hard_filters,
            dimension=key,
            value=item.get("value"),
            source="session_filter",
        )
    return hard_filters


def build_runtime_plan(
    *,
    query_text: str,
    has_images: bool,
    session_filters: list[dict] | None = None,
    session_active: bool = False,
    session_primary_category: str | None = None,
    session_preferences: dict[str, Any] | None = None,
    session_semantics: dict[str, str] | None = None,
    previous_plan: RuntimePlan | None = None,
) -> RuntimePlan:
    context = build_turn_context(
        query_text=query_text,
        has_images=has_images,
        session_filters=session_filters,
        session_active=session_active,
        session_primary_category=session_primary_category,
    )
    semantics = dict(session_semantics or {})
    plan = get_runtime_plan_from_payload(previous_plan)
    hard_filters = _collect_stable_session_filters(session_filters)

    preference_gender = str((session_preferences or {}).get("gender", "") or "").strip().lower()
    if preference_gender in {"female", "male"}:
        _append_runtime_hard_filter(
            hard_filters,
            dimension="gender",
            value=preference_gender,
            source="session_preference",
        )

    preference_quarters = expand_season_groups_to_quarters((session_preferences or {}).get("season_groups"))
    if not preference_quarters and (session_preferences or {}).get("quarter") not in (None, ""):
        preference_quarters = normalize_quarter_list((session_preferences or {}).get("quarter"))
    if preference_quarters:
        _append_runtime_hard_filter(
            hard_filters,
            dimension="quarter",
            value=preference_quarters,
            source="session_preference",
        )

    preference_years = normalize_year_list((session_preferences or {}).get("years"))
    if not preference_years and (session_preferences or {}).get("year") not in (None, ""):
        preference_years = normalize_year_list((session_preferences or {}).get("year"))
    if preference_years:
        _append_runtime_hard_filter(
            hard_filters,
            dimension="year",
            value=preference_years,
            source="session_preference",
        )

    preference_sources = normalize_site_list((session_preferences or {}).get("sources"))
    if preference_sources:
        _append_runtime_hard_filter(
            hard_filters,
            dimension="source_site",
            value=preference_sources,
            source="session_preference",
        )

    preference_image_types = normalize_image_type_list((session_preferences or {}).get("image_types"))
    if preference_image_types:
        _append_runtime_hard_filter(
            hard_filters,
            dimension="image_type",
            value=preference_image_types,
            source="session_preference",
        )

    primary_category = (
        context.get("primary_category", "").strip().lower()
        or str(semantics.get("primary_category", "")).strip().lower()
        or str(plan.get("default_category", "")).strip().lower()
    )
    if primary_category:
        _append_runtime_hard_filter(
            hard_filters,
            dimension="category",
            value=primary_category,
            source="category_inference",
        )

    style_retrieval_query = str(semantics.get("style_retrieval_query", "")).strip()
    vision_retrieval_query = str(semantics.get("vision_retrieval_query", "")).strip()
    style_name = str(semantics.get("primary_style_name", "")).strip()

    goal_type = "semantic_browse"
    if context.get("brand_only_request"):
        goal_type = "brand_focus"
    elif has_images and session_active:
        goal_type = "image_refinement"
    elif has_images:
        goal_type = "image_lookup"
    elif session_active:
        goal_type = "collection_refinement"
    elif primary_category:
        goal_type = "category_lookup"

    search_strategy = "semantic_browse"
    if has_images and query_text.strip():
        search_strategy = "image_plus_text"
    elif has_images:
        search_strategy = "image_first"
    elif style_retrieval_query or vision_retrieval_query:
        search_strategy = "style_grounded_semantic"
    elif primary_category:
        search_strategy = "semantic_with_category_guardrail"

    soft_cues: list[str] = []
    if style_name:
        soft_cues.append(f"style_name:{style_name}")
    if style_retrieval_query:
        soft_cues.append(f"style_query:{style_retrieval_query[:120]}")
    if vision_retrieval_query:
        soft_cues.append(f"vision_query:{vision_retrieval_query[:120]}")

    next_step_hint = "start_collection"
    blocked_tools: list[str] = []
    if context.get("brand_only_request"):
        next_step_hint = "add_brand_filter" if session_active else "start_collection_then_add_brand_filter"
        blocked_tools.append("analyze_trends")
    elif (style_retrieval_query or vision_retrieval_query) and session_active:
        next_step_hint = "show_or_light_refine"
    elif style_retrieval_query or vision_retrieval_query:
        next_step_hint = "start_collection"
    elif has_images and not primary_category:
        next_step_hint = "start_collection"
    elif session_active:
        next_step_hint = "refine_or_show"
    elif primary_category:
        next_step_hint = "start_collection"

    return {
        "goal_type": goal_type,
        "search_strategy": search_strategy,
        "default_category": primary_category,
        "hard_filters": hard_filters,
        "soft_cues": soft_cues,
        "policy_flags": {
            "prefer_existing_collection": bool(session_active),
            "seed_hard_filters_on_start": bool(hard_filters),
            "duplicate_filters_are_noop": True,
            "category_from_plan_can_autobind_garment_filters": bool(primary_category),
            "prefer_style_grounding": bool(style_retrieval_query or vision_retrieval_query),
            "brand_focus_skips_trend_analysis": bool(context.get("brand_only_request")),
            "image_query_requires_semantic_start_before_garment_trends": bool(has_images and not primary_category),
        },
        "next_step_hint": next_step_hint,
        "blocked_tools": blocked_tools,
    }


def format_runtime_plan(plan: RuntimePlan | None) -> str:
    normalized = get_runtime_plan_from_payload(plan)
    lines = [
        "[RUNTIME_PLAN]",
        f"goal_type={normalized.get('goal_type', '')}",
        f"search_strategy={normalized.get('search_strategy', '')}",
    ]
    default_category = str(normalized.get("default_category", "")).strip().lower()
    if default_category:
        lines.append(f"default_category={default_category}")
    hard_filters = normalized.get("hard_filters", [])
    if hard_filters:
        lines.append("hard_filters=" + ", ".join(
            f"{item['dimension']}:{'/'.join(str(part) for part in item['value']) if isinstance(item.get('value'), list) else item['value']}"
            for item in hard_filters
        ))
    soft_cues = normalized.get("soft_cues", [])
    if soft_cues:
        lines.append("soft_cues=" + " | ".join(soft_cues))
    next_step_hint = str(normalized.get("next_step_hint", "")).strip()
    if next_step_hint:
        lines.append(f"next_step_hint={next_step_hint}")
    blocked_tools = normalized.get("blocked_tools", [])
    if blocked_tools:
        lines.append("blocked_tools=" + ",".join(blocked_tools))
    policy_flags = normalized.get("policy_flags", {})
    for key in sorted(policy_flags):
        lines.append(f"{key}={'true' if policy_flags[key] else 'false'}")
    return "\n".join(lines)


def build_intent_brief(
    *,
    query_text: str,
    has_images: bool,
    session_active: bool,
    turn_context: TurnContext | None,
    runtime_plan: RuntimePlan | None,
    session_semantics: dict[str, str] | None = None,
) -> IntentBrief:
    context = turn_context or {}
    plan = get_runtime_plan_from_payload(runtime_plan)
    semantics = dict(session_semantics or {})

    user_goal = query_text.strip() or (
        "继续基于已上传图片找相似款"
        if has_images
        else "延续当前检索任务"
    )
    retrieval_intent = str(plan.get("goal_type", "")).strip() or "semantic_browse"
    collection_mode = "refine_existing_collection" if session_active else "start_new_collection"

    preferred_tool_sequence: list[str] = []
    required_preconditions: list[str] = []
    tool_constraints: list[str] = []
    execution_notes: list[str] = []

    next_step_hint = str(plan.get("next_step_hint", "")).strip()
    default_category = str(plan.get("default_category", "")).strip().lower()
    style_retrieval_query = str(semantics.get("style_retrieval_query", "")).strip()
    vision_retrieval_query = str(semantics.get("vision_retrieval_query", "")).strip()

    if has_images:
        preferred_tool_sequence.append("fashion_vision")
        required_preconditions.append("Use uploaded images as the primary grounding signal.")

    if style_retrieval_query and "search_style" not in preferred_tool_sequence:
        preferred_tool_sequence.append("start_collection")
        execution_notes.append("A style-grounded semantic query is already available; prefer semantic retrieval before hard filters.")
    elif vision_retrieval_query:
        if "start_collection" not in preferred_tool_sequence:
            preferred_tool_sequence.append("start_collection")
        execution_notes.append("Use the vision retrieval query as semantic grounding for the next collection start.")
    elif next_step_hint.startswith("start_collection") and "start_collection" not in preferred_tool_sequence:
        preferred_tool_sequence.append("start_collection")

    if next_step_hint in {"add_brand_filter", "start_collection_then_add_brand_filter"}:
        preferred_tool_sequence.append("add_filter(brand)")
        execution_notes.append("This is a direct brand-constrained retrieval flow, not an exploration task.")
    elif session_active:
        preferred_tool_sequence.append("add_filter_or_show_collection")
    else:
        preferred_tool_sequence.append("add_filter_then_show_collection")

    if default_category:
        required_preconditions.append(f"Default garment category is `{default_category}` for garment-level attributes.")
    if not default_category and has_images:
        tool_constraints.append("Do not call garment-level add_filter/analyze_trends until one garment category is resolved.")

    for blocked_tool in plan.get("blocked_tools", []):
        tool_constraints.append(f"Blocked tool: {blocked_tool}")

    if context.get("brand_only_request"):
        tool_constraints.append("Skip analyze_trends unless direct brand filtering fails.")
    if style_retrieval_query:
        tool_constraints.append("Do not translate abstract style cues into hard filters by default.")

    return {
        "user_goal": user_goal,
        "retrieval_intent": retrieval_intent,
        "collection_mode": collection_mode,
        "preferred_tool_sequence": preferred_tool_sequence,
        "required_preconditions": required_preconditions,
        "tool_constraints": tool_constraints,
        "execution_notes": execution_notes,
    }


def format_intent_brief(intent: IntentBrief | None) -> str:
    payload = intent or {}
    lines = [
        "[INTENT_BRIEF]",
        f"user_goal={str(payload.get('user_goal', '')).strip()}",
        f"retrieval_intent={str(payload.get('retrieval_intent', '')).strip()}",
        f"collection_mode={str(payload.get('collection_mode', '')).strip()}",
    ]
    preferred_tool_sequence = payload.get("preferred_tool_sequence", [])
    if preferred_tool_sequence:
        lines.append("preferred_tool_sequence=" + " -> ".join(
            str(item).strip() for item in preferred_tool_sequence if str(item).strip()
        ))
    required_preconditions = payload.get("required_preconditions", [])
    if required_preconditions:
        lines.append("required_preconditions=" + " | ".join(
            str(item).strip() for item in required_preconditions if str(item).strip()
        ))
    tool_constraints = payload.get("tool_constraints", [])
    if tool_constraints:
        lines.append("tool_constraints=" + " | ".join(
            str(item).strip() for item in tool_constraints if str(item).strip()
        ))
    execution_notes = payload.get("execution_notes", [])
    if execution_notes:
        lines.append("execution_notes=" + " | ".join(
            str(item).strip() for item in execution_notes if str(item).strip()
        ))
    return "\n".join(lines)


def build_planner_frame(
    *,
    runtime_plan: RuntimePlan | None,
    intent_brief: IntentBrief | None,
    execution_state: dict[str, Any] | None = None,
) -> PlannerFrame:
    plan = get_runtime_plan_from_payload(runtime_plan)
    intent = intent_brief or {}
    execution = dict(execution_state or {})

    blocked_tools = [
        str(item).strip()
        for item in plan.get("blocked_tools", [])
        if str(item).strip()
    ]
    current_stage = str(execution.get("current_stage", "")).strip()
    if not current_stage:
        collection_mode = str(intent.get("collection_mode", "")).strip()
        current_stage = "collection_active" if collection_mode == "refine_existing_collection" else "pre_execution"

    next_action = (
        str(execution.get("recommended_next_step", "")).strip()
        or str(plan.get("next_step_hint", "")).strip()
        or "start_collection"
    )
    if next_action == "start_collection_then_add_brand_filter":
        next_action = "start_collection"
    elif next_action == "add_brand_filter":
        next_action = 'add_filter("brand", "...")'

    allowed_tools: list[str]
    if current_stage in {"pre_execution", "ready_to_start_collection"}:
        allowed_tools = ["fashion_vision", "search_style", "start_collection"]
    elif current_stage == "collection_active":
        allowed_tools = ["add_filter", "remove_filter", "peek_collection", "show_collection", "analyze_trends"]
    elif current_stage == "ready_to_present":
        allowed_tools = ["show_collection", "remove_filter", "add_filter"]
    elif current_stage == "recovery_needed":
        allowed_tools = ["start_collection", "add_filter", "remove_filter", "search_style", "fashion_vision"]
    else:
        allowed_tools = ["start_collection", "add_filter", "show_collection"]

    disallowed_tools = list(dict.fromkeys([
        item for item in blocked_tools if item and item not in allowed_tools
    ] + blocked_tools))

    policy_flags = plan.get("policy_flags", {})
    planning_notes: list[str] = []
    if policy_flags.get("duplicate_filters_are_noop"):
        planning_notes.append("Do not repeat already active filters.")
    if policy_flags.get("image_query_requires_semantic_start_before_garment_trends"):
        planning_notes.append("Resolve category via semantic retrieval before garment-level trends/filters.")
    if policy_flags.get("brand_focus_skips_trend_analysis"):
        planning_notes.append("Single-brand flow should skip trend exploration.")

    completion_gate = "Show the collection once the pool is already aligned; avoid unnecessary extra filtering."
    if current_stage == "ready_to_present":
        completion_gate = "A presentable collection already exists; only restart or refilter if the user asks for a materially different direction."
    elif current_stage == "recovery_needed":
        completion_gate = "Repair the last failed strategy before making another tool call."

    return {
        "schema_version": "planner.v1",
        "current_stage": current_stage,
        "next_action": next_action,
        "allowed_tools": allowed_tools,
        "disallowed_tools": disallowed_tools,
        "completion_gate": completion_gate,
        "planning_notes": planning_notes,
    }


def format_planner_frame(frame: PlannerFrame | None) -> str:
    payload = frame or {}
    if not payload:
        return ""

    lines = ["[PLANNER_FRAME]"]
    for key in ("schema_version", "current_stage", "next_action", "completion_gate"):
        value = str(payload.get(key, "")).strip()
        if value:
            lines.append(f"{key}={value}")
    allowed_tools = payload.get("allowed_tools", [])
    if allowed_tools:
        lines.append("allowed_tools=" + ", ".join(
            str(item).strip() for item in allowed_tools if str(item).strip()
        ))
    disallowed_tools = payload.get("disallowed_tools", [])
    if disallowed_tools:
        lines.append("disallowed_tools=" + ", ".join(
            str(item).strip() for item in disallowed_tools if str(item).strip()
        ))
    planning_notes = payload.get("planning_notes", [])
    if planning_notes:
        lines.append("planning_notes=" + " | ".join(
            str(item).strip() for item in planning_notes if str(item).strip()
        ))
    return "\n".join(lines)


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
            "category_bound_filters_without_single_category=forbidden",
            "unresolved_image_category_prefers_semantic_query=true",
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
    lines.append("abstract_style_retrieval_query_is_primary_execution_payload=true")
    lines.append("abstract_style_do_not_apply_filters_by_default=true")
    lines.append("style_grounded_collection_prefers_show_before_filtering=true")
    lines.append("abstract_style_dual_show_collection_allowed=true")
    lines.append("abstract_style_second_result_group_requires_meaningful_difference=true")
    lines.append("unsupported_filter_dimensions=style,mood,vibe")

    if primary_category:
        lines.append(f"inferred_primary_category={primary_category}")
        lines.append(
            f"garment_attribute_default_category={primary_category}"
        )
        lines.append(
            f"recommended_next_filters=category:{primary_category} before garment attributes if session has no category yet"
        )

    if context.get("brand_only_request"):
        lines.append("request_focus=single_brand_only")
        lines.append("single_brand_request_prefers_direct_brand_filter=true")
        lines.append("single_brand_filter_dimension=brand")
        lines.append("single_brand_request_should_skip_trend_analysis_until_brand_filter_fails=true")

    return "\n".join(lines)
