from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from typing import Any

from ..agent.harness import infer_categories_from_text
from ..agent.qdrant_utils import get_qdrant
from ..agent.session_state import count_session
from .chat_reference_service import build_bundle_group_metadata, build_bundle_result_metadata
from .chat_service import create_artifact, get_artifact


def _format_filter_entry(filter_item: dict[str, Any]) -> str:
    filter_type = str(filter_item.get("type", "")).strip().lower()
    if filter_type == "category":
        return f"category={str(filter_item.get('value', '')).strip()}"
    if filter_type == "garment_tag":
        key = str(filter_item.get("key", "")).strip()
        value = str(filter_item.get("value", "")).strip()
        suffix = value.split(":", 1)[1].strip() if ":" in value else value
        return f"{key}={suffix}" if key else suffix
    if filter_type == "garment_attr":
        key = str(filter_item.get("key", "")).strip()
        value = str(filter_item.get("value", "")).strip()
        return f"{key}={value}" if key else value
    if filter_type == "meta":
        key = str(filter_item.get("key", "")).strip()
        value = str(filter_item.get("value", "")).strip()
        return f"{key}={value}" if key else value
    return str(filter_item)


def _extract_latest_style_payload(blocks: list[dict[str, Any]]) -> dict[str, Any] | None:
    for block in reversed(blocks):
        if not isinstance(block, dict) or block.get("type") != "tool_result":
            continue
        content = block.get("content")
        if not isinstance(content, str) or not content:
            continue
        try:
            payload = json.loads(content)
        except json.JSONDecodeError:
            continue
        if isinstance(payload, dict) and payload.get("primary_style") and payload.get("retrieval_plan"):
            return payload
    return None


def _normalize_value(value: Any) -> str:
    return str(value or "").strip().lower()


def _normalize_suggested_filters(style_payload: dict[str, Any]) -> dict[str, set[str]]:
    plan = style_payload.get("retrieval_plan") if isinstance(style_payload.get("retrieval_plan"), dict) else {}
    raw_filters = plan.get("suggested_filters") if isinstance(plan, dict) else {}
    if not isinstance(raw_filters, dict):
        return {}

    normalized: dict[str, set[str]] = {}
    for key, raw in raw_filters.items():
        values: list[str] = []
        if isinstance(raw, list):
            values = [_normalize_value(item) for item in raw if _normalize_value(item)]
        else:
            normalized_value = _normalize_value(raw)
            if normalized_value:
                values = [normalized_value]
        if values:
            normalized[_normalize_value(key)] = set(values)
    return normalized


def _filter_matches_style_suggestion(filter_item: dict[str, Any], suggested_filters: dict[str, set[str]]) -> bool:
    filter_type = str(filter_item.get("type", "")).strip().lower()
    if filter_type == "meta":
        key = _normalize_value(filter_item.get("key"))
        value = _normalize_value(filter_item.get("value"))
        return bool(key and value and value in suggested_filters.get(key, set()))

    if filter_type == "garment_tag":
        key = _normalize_value(filter_item.get("key"))
        dim = key.split(":", 1)[1] if ":" in key else key
        value = _normalize_value(filter_item.get("value"))
        if ":" in value:
            value = value.split(":", 1)[1].strip().lower()
        return bool(dim and value and value in suggested_filters.get(dim, set()))

    if filter_type == "garment_attr":
        key = _normalize_value(filter_item.get("key"))
        dim = key.split(":", 1)[1] if ":" in key else _normalize_value(filter_item.get("field"))
        value = _normalize_value(filter_item.get("value"))
        return bool(dim and value and value in suggested_filters.get(dim, set()))

    return False


def _build_semantic_group_session(
    search_session: dict[str, Any],
    *,
    request_query_text: str,
    style_payload: dict[str, Any],
) -> dict[str, Any] | None:
    filters = search_session.get("filters")
    if not isinstance(filters, list) or not filters:
        return None

    suggested_filters = _normalize_suggested_filters(style_payload)
    explicit_categories = infer_categories_from_text(request_query_text or "")
    explicit_category = explicit_categories[0] if len(explicit_categories) == 1 else None

    semantic_filters: list[dict[str, Any]] = []
    for filter_item in filters:
        if not isinstance(filter_item, dict):
            continue
        filter_type = str(filter_item.get("type", "")).strip().lower()
        if filter_type == "category":
            value = _normalize_value(filter_item.get("value"))
            if explicit_category and value == explicit_category:
                semantic_filters.append(dict(filter_item))
            continue
        if filter_type in {"garment_tag", "garment_attr"}:
            continue
        if _filter_matches_style_suggestion(filter_item, suggested_filters):
            continue
        semantic_filters.append(dict(filter_item))

    if semantic_filters == filters:
        return None

    semantic_session = dict(search_session)
    semantic_session["filters"] = semantic_filters
    semantic_session["active"] = True
    return semantic_session


def _materialize_collection_artifact(
    *,
    session_id: str,
    message_id: str,
    search_session: dict[str, Any],
    group_label: str,
) -> dict[str, Any]:
    client = get_qdrant()
    total = count_session(client, search_session)
    filter_summary = [_format_filter_entry(item) for item in search_session.get("filters", []) if isinstance(item, dict)]

    artifact = create_artifact(
        session_id=session_id,
        message_id=message_id,
        artifact_type="collection_result",
        storage_type="database",
        metadata={
            "search_session": search_session,
            "total": total,
            "filters_applied": filter_summary,
            "group_label": group_label,
        },
        expires_at=datetime.now(timezone.utc) + timedelta(days=7),
    )

    return {
        "artifact": artifact,
        "group": build_bundle_group_metadata(
            group_id=str(artifact["id"]),
            label=group_label,
            search_request_id=str(artifact["id"]),
            query=str(search_session.get("query", "") or "").strip(),
            filters_applied=filter_summary,
            total=total,
        ),
    }


def _preview_collection_group(
    *,
    search_session: dict[str, Any],
    group_label: str,
) -> BundleResultGroup:
    client = get_qdrant()
    total = count_session(client, search_session)
    filter_summary = [_format_filter_entry(item) for item in search_session.get("filters", []) if isinstance(item, dict)]
    return build_bundle_group_metadata(
        group_id="preview",
        label=group_label,
        search_request_id="preview",
        query=str(search_session.get("query", "") or "").strip(),
        filters_applied=filter_summary,
        total=total,
    )


def maybe_materialize_style_bundle(
    *,
    session_id: str,
    message_id: str,
    blocks: list[dict[str, Any]],
    request_query_text: str = "",
) -> dict[str, Any] | None:
    from .chat_reference_service import extract_collection_result_payloads

    collection_payloads = extract_collection_result_payloads(blocks)
    if len(collection_payloads) != 1:
        return None

    style_payload = _extract_latest_style_payload(blocks)
    if not style_payload:
        return None

    final_payload = collection_payloads[0]
    final_search_request_id = str(final_payload.get("search_request_id", "")).strip()
    if not final_search_request_id:
        return None

    final_artifact = get_artifact(final_search_request_id, session_id=session_id, artifact_type="collection_result")
    if not final_artifact:
        return None

    final_metadata = final_artifact.get("metadata", {}) if isinstance(final_artifact.get("metadata"), dict) else {}
    final_search_session = final_metadata.get("search_session") if isinstance(final_metadata.get("search_session"), dict) else None
    if not final_search_session:
        return None

    semantic_session = _build_semantic_group_session(
        final_search_session,
        request_query_text=request_query_text,
        style_payload=style_payload,
    )
    if not semantic_session:
        return None

    style_name = ""
    primary_style = style_payload.get("primary_style") if isinstance(style_payload.get("primary_style"), dict) else {}
    if isinstance(primary_style, dict):
        style_name = str(primary_style.get("style_name", "") or "").strip()

    broad_label = f"{style_name} · 语义参考" if style_name else "风格语义参考"
    refined_label = f"{style_name} · 精筛结果" if style_name else "风格精筛结果"

    semantic_preview = _preview_collection_group(
        search_session=semantic_session,
        group_label=broad_label,
    )
    semantic_total = int(semantic_preview.get("total", 0) or 0)
    final_total = int(final_payload.get("total", 0) or 0)
    removed_filter_count = max(
        0,
        len(final_search_session.get("filters", [])) - len(semantic_session.get("filters", [])),
    )
    if (
        semantic_total <= final_total
        or removed_filter_count < 2
        or semantic_total < max(24, final_total + 24)
    ):
        return None

    semantic_artifact_payload = _materialize_collection_artifact(
        session_id=session_id,
        message_id=message_id,
        search_session=semantic_session,
        group_label=broad_label,
    )

    final_group = build_bundle_group_metadata(
        group_id=str(final_artifact["id"]),
        label=refined_label,
        search_request_id=str(final_artifact["id"]),
        query=str(final_payload.get("query", "") or "").strip(),
        filters_applied=final_payload.get("filters_applied", []) if isinstance(final_payload.get("filters_applied"), list) else [],
        total=int(final_payload.get("total", 0) or 0),
    )

    groups = [semantic_artifact_payload["group"], final_group]
    bundle_artifact = create_artifact(
        session_id=session_id,
        message_id=message_id,
        artifact_type="bundle_result",
        storage_type="database",
        metadata=build_bundle_result_metadata(groups=groups, bundle_kind="style_exploration"),
        expires_at=datetime.now(timezone.utc) + timedelta(days=7),
    )

    return {
        "artifact": bundle_artifact,
        "groups": groups,
    }
