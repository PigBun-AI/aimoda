from __future__ import annotations

import base64
import json
from typing import Any


MessageRefTarget = dict[str, Any]
BundleResultGroup = dict[str, Any]


def build_message_ref_url(target: MessageRefTarget) -> str:
    payload = json.dumps(target, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    encoded = base64.urlsafe_b64encode(payload).decode("ascii").rstrip("=")
    return f"aimoda://ref/{encoded}"


def build_search_request_ref(*, search_request_id: str, label: str, source: str = "collection_result") -> MessageRefTarget:
    return {
        "kind": "search_request",
        "search_request_id": str(search_request_id),
        "label": str(label),
        "source": source,
    }


def build_bundle_group_ref(*, artifact_id: str, group_id: str, label: str) -> MessageRefTarget:
    return {
        "kind": "bundle_group",
        "artifact_id": str(artifact_id),
        "group_id": str(group_id),
        "label": str(label),
    }


def build_search_plan_ref(
    *,
    session_id: str,
    label: str,
    query: str = "",
    categories: list[str] | None = None,
    brand: str | None = None,
    gender: str | None = None,
    quarter: str | None = None,
    year_min: int | None = None,
    image_type: str | None = None,
    source: str = "agent_recommendation",
) -> MessageRefTarget:
    payload: MessageRefTarget = {
        "kind": "search_plan",
        "session_id": str(session_id),
        "label": str(label),
        "query": str(query or "").strip(),
        "source": str(source or "agent_recommendation"),
    }
    normalized_categories = [str(item).strip().lower() for item in (categories or []) if str(item).strip()]
    if normalized_categories:
        payload["categories"] = normalized_categories
    if brand:
        payload["brand"] = str(brand).strip()
    if gender:
        payload["gender"] = str(gender).strip()
    if quarter:
        payload["quarter"] = str(quarter).strip()
    if year_min is not None:
        payload["year_min"] = int(year_min)
    if image_type:
        payload["image_type"] = str(image_type).strip()
    return payload


def build_bundle_group_metadata(
    *,
    group_id: str,
    label: str,
    search_request_id: str,
    query: str = "",
    filters_applied: list[str] | None = None,
    total: int = 0,
) -> BundleResultGroup:
    return {
        "group_id": str(group_id),
        "label": str(label),
        "search_request_id": str(search_request_id),
        "query": str(query or "").strip(),
        "filters_applied": [str(item).strip() for item in (filters_applied or []) if str(item).strip()],
        "total": int(total or 0),
    }


def summarize_collection_label(payload: dict[str, Any], *, index: int, total_groups: int) -> str:
    filters = payload.get("filters_applied")
    compact_filters = [str(item).strip() for item in filters if str(item).strip()] if isinstance(filters, list) else []
    query = str(payload.get("query", "")).strip()

    if compact_filters:
        summary = " · ".join(compact_filters[:2])
    elif query:
        summary = query[:36]
    else:
        summary = "检索结果"

    if total_groups <= 1:
        return summary
    return f"结果组 {index} · {summary}"


def extract_collection_result_payloads(blocks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    collection_payloads: list[dict[str, Any]] = []
    for block in blocks:
        if not isinstance(block, dict) or block.get("type") != "tool_result":
            continue
        content = block.get("content")
        if not isinstance(content, str) or not content:
            continue
        try:
            payload = json.loads(content)
        except json.JSONDecodeError:
            continue
        if not isinstance(payload, dict) or payload.get("action") != "show_collection":
            continue
        search_request_id = str(payload.get("search_request_id", "")).strip()
        if not search_request_id:
            continue
        collection_payloads.append(payload)
    return collection_payloads


def dedupe_collection_result_blocks(blocks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not blocks:
        return blocks

    seen_signatures: set[tuple[str, tuple[str, ...], int]] = set()
    duplicate_tool_use_ids: set[str] = set()

    for block in blocks:
        if not isinstance(block, dict) or block.get("type") != "tool_result":
            continue
        content = block.get("content")
        if not isinstance(content, str) or not content:
            continue
        try:
            payload = json.loads(content)
        except json.JSONDecodeError:
            continue
        if not isinstance(payload, dict) or payload.get("action") != "show_collection":
            continue

        signature = (
            str(payload.get("query", "") or "").strip().lower(),
            tuple(
                str(item).strip().lower()
                for item in (payload.get("filters_applied") or [])
                if str(item).strip()
            ),
            int(payload.get("total", 0) or 0),
        )
        tool_use_id = str(block.get("tool_use_id", "")).strip()
        if signature in seen_signatures and tool_use_id:
            duplicate_tool_use_ids.add(tool_use_id)
            continue
        seen_signatures.add(signature)

    if not duplicate_tool_use_ids:
        return blocks

    deduped: list[dict[str, Any]] = []
    for block in blocks:
        if not isinstance(block, dict):
            deduped.append(block)
            continue

        if block.get("type") == "tool_use" and str(block.get("id", "")).strip() in duplicate_tool_use_ids:
            continue
        if block.get("type") == "tool_result" and str(block.get("tool_use_id", "")).strip() in duplicate_tool_use_ids:
            continue
        deduped.append(block)

    return deduped


def _build_groups_from_payloads(collection_payloads: list[dict[str, Any]]) -> list[BundleResultGroup]:
    total_groups = len(collection_payloads)
    groups: list[BundleResultGroup] = []
    for index, payload in enumerate(collection_payloads, start=1):
        search_request_id = str(payload.get("search_request_id", "")).strip()
        groups.append(
            build_bundle_group_metadata(
                group_id=search_request_id,
                label=summarize_collection_label(payload, index=index, total_groups=total_groups),
                search_request_id=search_request_id,
                query=str(payload.get("query", "") or "").strip(),
                filters_applied=payload.get("filters_applied", []) if isinstance(payload.get("filters_applied"), list) else [],
                total=int(payload.get("total", 0) or 0),
            )
        )
    return groups


def build_bundle_result_metadata(
    collection_payloads: list[dict[str, Any]] | None = None,
    *,
    groups: list[BundleResultGroup] | None = None,
    bundle_kind: str | None = None,
) -> dict[str, Any]:
    resolved_groups = [dict(group) for group in groups] if groups else _build_groups_from_payloads(collection_payloads or [])
    payload: dict[str, Any] = {
        "group_count": len(resolved_groups),
        "groups": resolved_groups,
    }
    if bundle_kind:
        payload["bundle_kind"] = str(bundle_kind)
    return payload


def _dedupe_phrases(phrases: list[str]) -> list[str]:
    seen: set[str] = set()
    deduped: list[str] = []
    for raw in phrases:
        phrase = str(raw or "").strip()
        if len(phrase) < 2:
            continue
        normalized = phrase.casefold()
        if normalized in seen:
            continue
        seen.add(normalized)
        deduped.append(phrase)
    return deduped


def _extract_filter_phrase_candidates(filters_applied: list[str]) -> list[str]:
    phrases: list[str] = []
    for raw_filter in filters_applied:
        filter_entry = str(raw_filter or "").strip()
        if "=" not in filter_entry:
            continue

        key, value = filter_entry.split("=", 1)
        filter_key = key.strip().lower()
        filter_value = value.strip()
        if not filter_value:
            continue

        phrases.append(filter_value)
        if filter_key == "brand":
            phrases.extend([
                filter_value.title(),
                filter_value.upper(),
                f"{filter_value.title()} 系列",
                f"{filter_value.title()} 的",
            ])
        elif filter_key == "quarter":
            phrases.extend([
                f"{filter_value}系列",
                f"{filter_value}方向",
                f"{filter_value}结果",
            ])

    return _dedupe_phrases(phrases)


def _extract_group_phrase_candidates(
    *,
    label: str,
    query: str,
    filters_applied: list[str],
) -> list[str]:
    phrases: list[str] = []
    clean_label = str(label or "").strip()
    clean_query = str(query or "").strip()
    if clean_label:
        phrases.append(clean_label)
        if "·" in clean_label:
            phrases.extend(part.strip() for part in clean_label.split("·"))
    if clean_query:
        phrases.append(clean_query)
    phrases.extend(_extract_filter_phrase_candidates(filters_applied))
    return _dedupe_phrases(sorted(phrases, key=len, reverse=True))


def _build_message_ref_annotation(
    *,
    count: int,
    items: list[dict[str, Any]],
) -> dict[str, Any]:
    return {
        "type": "message_refs",
        "count": int(count),
        "items": items,
    }


def _replace_or_append_message_ref_annotations(
    blocks: list[dict[str, Any]],
    *,
    annotation: dict[str, Any],
    summary_text: str,
) -> list[dict[str, Any]]:
    next_blocks = [dict(block) if isinstance(block, dict) else block for block in blocks]
    last_text_index: int | None = None

    for index, block in enumerate(next_blocks):
        if isinstance(block, dict) and block.get("type") == "text":
            last_text_index = index

    if last_text_index is None:
        next_blocks.append({
            "type": "text",
            "text": summary_text,
            "annotations": [annotation],
        })
        return next_blocks

    text_block = dict(next_blocks[last_text_index])
    annotations = text_block.get("annotations")
    kept_annotations = [
        dict(item)
        for item in (annotations if isinstance(annotations, list) else [])
        if isinstance(item, dict) and item.get("type") != "message_refs"
    ]
    kept_annotations.append(annotation)
    text_block["annotations"] = kept_annotations
    next_blocks[last_text_index] = text_block

    compacted_blocks: list[dict[str, Any]] = []
    for block in next_blocks:
        if (
            isinstance(block, dict)
            and block.get("type") == "text"
            and any(
                isinstance(annotation_item, dict) and annotation_item.get("type") == "message_refs"
                for annotation_item in (block.get("annotations") or [])
                if isinstance(block.get("annotations"), list)
            )
            and block is not text_block
            and not str(block.get("text", "")).strip()
        ):
            continue
        compacted_blocks.append(block)

    return compacted_blocks


def _build_bundle_ref_items(
    *,
    artifact_id: str,
    groups: list[BundleResultGroup],
) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for index, group in enumerate(groups, start=1):
        label = str(group.get("label", "")).strip() or "检索结果"
        group_id = str(group.get("group_id", "")).strip() or str(group.get("search_request_id", "")).strip()
        if not group_id:
            continue
        query = str(group.get("query", "") or "").strip()
        filters_applied = group.get("filters_applied", [])
        normalized_filters = filters_applied if isinstance(filters_applied, list) else []
        items.append({
            "index": index,
            "label": label,
            "target": build_bundle_group_ref(
                artifact_id=artifact_id,
                group_id=group_id,
                label=label,
            ),
            "phrases": _extract_group_phrase_candidates(
                label=label,
                query=query,
                filters_applied=normalized_filters,
            ),
        })
    return items


def _build_collection_ref_items(collection_payloads: list[dict[str, Any]]) -> list[dict[str, Any]]:
    total_groups = len(collection_payloads)
    items: list[dict[str, Any]] = []
    for index, payload in enumerate(collection_payloads, start=1):
        search_request_id = str(payload.get("search_request_id", "")).strip()
        if not search_request_id:
            continue
        label = summarize_collection_label(payload, index=index, total_groups=total_groups)
        filters_applied = payload.get("filters_applied", [])
        normalized_filters = filters_applied if isinstance(filters_applied, list) else []
        items.append({
            "index": index,
            "label": label,
            "target": build_search_request_ref(
                search_request_id=search_request_id,
                label=label,
            ),
            "phrases": _extract_group_phrase_candidates(
                label=label,
                query=str(payload.get("query", "") or "").strip(),
                filters_applied=normalized_filters,
            ),
        })
    return items


def append_bundle_group_references(
    blocks: list[dict[str, Any]],
    *,
    artifact_id: str,
    groups: list[BundleResultGroup],
) -> list[dict[str, Any]]:
    if not groups:
        return blocks

    items = _build_bundle_ref_items(artifact_id=artifact_id, groups=groups)
    if not items:
        return blocks

    links = [
        f"[{item['label']}]({build_message_ref_url(item['target'])})"
        for item in items
        if isinstance(item.get("target"), dict)
    ]
    prefix = "查看结果：" if len(items) == 1 else "查看结果组："
    summary_text = f"{prefix} {'  '.join(links)}"
    return _replace_or_append_message_ref_annotations(
        blocks,
        annotation=_build_message_ref_annotation(count=len(items), items=items),
        summary_text=summary_text,
    )


def append_collection_result_references(
    blocks: list[dict[str, Any]],
    *,
    bundle_artifact_id: str | None = None,
    bundle_groups: list[BundleResultGroup] | None = None,
) -> list[dict[str, Any]]:
    if not blocks:
        return blocks

    if bundle_artifact_id:
        groups = [dict(group) for group in bundle_groups] if bundle_groups else _build_groups_from_payloads(extract_collection_result_payloads(blocks))
        if groups:
            return append_bundle_group_references(
                blocks,
                artifact_id=bundle_artifact_id,
                groups=groups,
            )

    collection_payloads = extract_collection_result_payloads(blocks)
    if not collection_payloads:
        return blocks

    items = _build_collection_ref_items(collection_payloads)
    if not items:
        return blocks

    links = [
        f"[{item['label']}]({build_message_ref_url(item['target'])})"
        for item in items
        if isinstance(item.get("target"), dict)
    ]
    prefix = "查看结果：" if len(items) == 1 else "查看结果组："
    summary_text = f"{prefix} {'  '.join(links)}"
    return _replace_or_append_message_ref_annotations(
        blocks,
        annotation=_build_message_ref_annotation(count=len(items), items=items),
        summary_text=summary_text,
    )
