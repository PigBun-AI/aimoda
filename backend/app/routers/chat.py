"""
Chat Router — API endpoints for the fashion search agent chat.

Endpoints:
  POST /api/chat           — SSE streaming chat (with JWT auth)
  POST /api/chat/search_session — Direct search for Drawer pagination
  GET  /api/chat/sessions  — List user's chat sessions
  POST /api/chat/sessions  — Create a new session
  PATCH /api/chat/sessions/{id} — Update session title
  DELETE /api/chat/sessions/{id} — Delete a session
  GET  /api/chat/sessions/{id}/messages — Get session messages
"""

import asyncio
import base64
import binascii
import json
import logging
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Annotated, Any, AsyncGenerator

from fastapi import APIRouter, Depends, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import StreamingResponse, JSONResponse
from pydantic import BaseModel

from ..config import settings
from ..dependencies import get_current_user, require_role
from ..models import AuthenticatedUser
from ..services import catalog_image_service
from ..services.feature_access_service import consume_feature_access, get_feature_access_status
from ..services.favorite_service import annotate_catalog_image_results
from ..services.chat_reference_service import (
    append_collection_result_references,
    build_bundle_result_metadata,
    dedupe_collection_result_blocks,
    extract_collection_result_payloads,
)
from ..services.chat_ref_linker_service import attach_message_ref_spans
from ..services.chat_search_plan_ref_service import attach_search_plan_ref_spans
from ..services.chat_structured_ref_service import (
    REFS_END_MARKER,
    REFS_START_MARKER,
    attach_structured_message_refs,
)
from ..services.chat_runtime_ref_service import attach_runtime_brand_refs
from ..services.search_plan_service import materialize_search_plan_ref
from ..services.chat_bundle_service import maybe_materialize_style_bundle
from ..services.chat_service import (
    create_artifact,
    create_session,
    list_sessions,
    update_session_preferences,
    delete_session,
    touch_session,
    get_thread_id,
    get_session,
    list_messages,
    create_message,
    update_message,
    auto_title_session,
    finalize_session_title,
    set_session_execution_status,
    get_artifact,
    get_session_agent_runtime,
    merge_session_agent_runtime,
    maybe_compact_session,
    get_compaction_bootstrap_payload,
    clear_compaction_bootstrap,
    reset_session_runtime_checkpoint,
)
from ..services.taste_profile_service import apply_taste_profile_to_query
from ..services.oss_service import get_oss_service
from ..services.websocket_manager import ws_manager
from ..services.chat_run_registry import ChatRunCancelledError, chat_run_registry
from ..services.auth_token import verify_access_token
from ..repositories.session_repo import is_session_valid
from ..agent.graph import get_agent
from ..agent.sse import stream_agent_response, StreamResult, sse_event
from ..agent.qdrant_utils import get_qdrant, format_result, get_collection, encode_image
from ..value_normalization import (
    CANONICAL_SEASON_GROUPS,
    normalize_image_type_list,
    normalize_quarter_value,
    normalize_site_list,
    normalize_year_list,
)
from ..agent.session_state import (
    count_session,
    get_session_page,
    get_session as get_agent_session,
    set_session as set_agent_session,
)
from ..agent.harness import (
    build_intent_brief,
    build_planner_frame,
    build_runtime_plan,
    build_turn_context,
    build_turn_playbook,
    format_intent_brief,
    format_planner_frame,
    format_runtime_plan,
    get_runtime_plan,
    get_session_semantics,
    get_runtime_plan_from_payload,
    set_runtime_plan,
    set_session_semantics,
    update_session_semantics,
    set_turn_context,
    clear_turn_context,
)
from ..agent.runtime_reducer import (
    format_execution_state,
    merge_execution_state,
    reduce_tool_result_blocks,
)
from ..agent.query_context import (
    set_query_context,
    remember_session_images,
    remember_session_style,
    remember_session_vision,
    get_session_image_blocks,
    get_session_query_context,
    merge_query_contexts,
)

router = APIRouter(prefix="/chat", tags=["chat"])
logger = logging.getLogger(__name__)
_detached_post_run_tasks: set[asyncio.Task[Any]] = set()
REF_ENRICHMENT_TIMEOUT_SECONDS = settings.REF_ENRICHMENT_TIMEOUT_SECONDS


# ── Request/Response models ──

class ChatRequest(BaseModel):
    content: list[dict[str, Any]]
    session_id: str
    history: list[dict] = []


class SessionPreferencesPayload(BaseModel):
    gender: str | None = None
    quarter: str | list[str] | None = None
    year: int | list[int] | None = None
    season_groups: list[str] | None = None
    years: list[int] | None = None
    sources: list[str] | None = None
    image_types: list[str] | None = None
    taste_profile_id: str | None = None
    taste_profile_weight: float | None = None


class CreateSessionRequest(BaseModel):
    title: str = "新对话"
    preferences: SessionPreferencesPayload | None = None


class UpdateSessionRequest(BaseModel):
    title: str | None = None
    pinned: bool | None = None
    preferences: SessionPreferencesPayload | None = None


class ListMessagesRequest(BaseModel):
    limit: int = 100
    offset: int = 0
    include_system: bool = True


class SearchSessionRequest(BaseModel):
    """Direct search API using the Agent's internal session state."""
    search_request_id: str
    offset: int = 0
    limit: int = 50
    taste_profile_id: str | None = None
    taste_profile_weight: float | None = None


class StopSessionRunRequest(BaseModel):
    run_id: str | None = None


class ResolveSearchPlanRefRequest(BaseModel):
    session_id: str
    current_session_id: str | None = None
    label: str | None = None
    query: str = ""
    categories: list[str] | None = None
    brand: str | None = None
    gender: str | None = None
    quarter: str | None = None
    year_min: int | None = None
    image_type: str | None = None
    source: str | None = None


def _facet_preference_values(
    *,
    client,
    field: str,
    limit: int = 64,
) -> list[dict[str, Any]]:
    try:
        response = client.facet(
            collection_name=get_collection(),
            key=field,
            limit=limit,
            exact=False,
        )
    except Exception:
        return []

    hits = getattr(response, "hits", []) or []
    return [dict(value=getattr(hit, "value", None), count=int(getattr(hit, "count", 0) or 0)) for hit in hits]


def _serialize_chat_preference_options() -> dict[str, Any]:
    client = get_qdrant()

    raw_site_hits = _facet_preference_values(client=client, field="source_site")
    if not raw_site_hits:
        raw_site_hits = _facet_preference_values(client=client, field="source")
    raw_image_type_hits = _facet_preference_values(client=client, field="image_type")
    raw_year_hits = _facet_preference_values(client=client, field="year")

    sites: list[dict[str, Any]] = []
    seen_sites: set[str] = set()
    for item in raw_site_hits:
        site_values = normalize_site_list(item.get("value"))
        if not site_values:
            continue
        site = site_values[0]
        if site in seen_sites:
            continue
        seen_sites.add(site)
        sites.append({"value": site, "count": int(item.get("count", 0) or 0)})

    image_type_order = {"model_photo": 0, "flat_lay": 1}
    image_types: list[dict[str, Any]] = []
    seen_image_types: set[str] = set()
    for item in raw_image_type_hits:
        values = normalize_image_type_list(item.get("value"))
        if not values:
            continue
        image_type = values[0]
        if image_type in seen_image_types:
            continue
        seen_image_types.add(image_type)
        image_types.append({"value": image_type, "count": int(item.get("count", 0) or 0)})
    image_types.sort(key=lambda item: (image_type_order.get(str(item.get("value")), 99), str(item.get("value"))))

    years: list[dict[str, Any]] = []
    seen_years: set[int] = set()
    for item in raw_year_hits:
        normalized_years = normalize_year_list(item.get("value"))
        if not normalized_years:
            continue
        year = normalized_years[0]
        if year in seen_years:
            continue
        seen_years.add(year)
        years.append({"value": year, "count": int(item.get("count", 0) or 0)})
    years.sort(key=lambda item: int(item.get("value", 0) or 0), reverse=True)

    season_groups = []
    for season_group in CANONICAL_SEASON_GROUPS:
        season_groups.append({
            "value": season_group,
            "label": season_group,
        })

    return {
        "sites": sites,
        "image_types": image_types,
        "years": years,
        "season_groups": season_groups,
    }


def _normalize_message_content(content: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Validate and copy incoming content blocks."""
    return [dict(block) for block in content if isinstance(block, dict)]


def _persist_inline_media_blocks(
    session_id: str,
    blocks: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Upload inline base64 media to OSS and replace with URL sources."""
    oss = get_oss_service()
    normalized: list[dict[str, Any]] = []

    for index, block in enumerate(blocks):
        next_block = dict(block)
        if next_block.get("type") != "image":
            normalized.append(next_block)
            continue

        source = next_block.get("source")
        if not isinstance(source, dict) or source.get("type") != "base64":
            normalized.append(next_block)
            continue

        media_type = str(source.get("media_type", "")).strip()
        encoded = str(source.get("data", "")).strip()
        if not media_type or not encoded:
            normalized.append(next_block)
            continue

        try:
            image_bytes = base64.b64decode(encoded, validate=True)
        except (ValueError, binascii.Error):
            normalized.append(next_block)
            continue

        extension = media_type.split("/")[-1] if "/" in media_type else "bin"
        filename = str(next_block.get("file_name", "")).strip() or f"chat-upload-{index}.{extension}"
        try:
            url = oss.upload_artifact(
                session_id=session_id,
                artifact_type="image",
                file_content=image_bytes,
                filename=filename,
                content_type=media_type,
                metadata={"source": "chat_message"},
            )
        except Exception:
            normalized.append(next_block)
            continue

        next_block["source"] = {"type": "url", "url": url}
        normalized.append(next_block)

    return normalized


def _extract_text_from_blocks(blocks: list[dict[str, Any]]) -> str:
    parts: list[str] = []
    has_image = False
    for block in blocks:
        if block.get("type") == "text":
            text = str(block.get("text", "")).strip()
            if text:
                parts.append(text)
        elif block.get("type") == "image":
            has_image = True
            file_name = str(block.get("file_name", "")).strip()
            parts.append(f"[用户上传了图片{f'：{file_name}' if file_name else ''}]")
        elif block.get("type") == "document":
            file_name = str(block.get("file_name", "")).strip()
            parts.append(f"[用户上传了文件{f'：{file_name}' if file_name else ''}]")
    text = "\n".join(parts).strip()
    if has_image and not any(block.get("type") == "text" and str(block.get("text", "")).strip() for block in blocks):
        return "图片检索"
    return text


def _extract_image_blocks(blocks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [dict(block) for block in blocks if block.get("type") == "image"]


def _materialize_stream_blocks(stream_result: StreamResult) -> list[dict[str, Any]]:
    return [
        dict(block)
        for block in stream_result.content_blocks
        if isinstance(block, dict) and block
    ]

def _create_bundle_result_artifact(
    *,
    session_id: str,
    message_id: str | None,
    blocks: list[dict[str, Any]],
) -> dict[str, Any] | None:
    collection_payloads = extract_collection_result_payloads(blocks)
    if len(collection_payloads) <= 1:
        return None

    return create_artifact(
        session_id=session_id,
        message_id=message_id,
        artifact_type="bundle_result",
        storage_type="database",
        metadata=build_bundle_result_metadata(collection_payloads),
        expires_at=datetime.now(timezone.utc) + timedelta(days=7),
    )


async def _persist_streaming_assistant_message(
    *,
    session_id: str,
    message_id: str | None,
    stream_result: StreamResult,
    stream_state: str,
    run_id: str | None = None,
    thread_version: int | None = None,
    request_query_text: str = "",
) -> tuple[str | None, list[dict[str, Any]] | None]:
    raw_blocks = _materialize_stream_blocks(stream_result)
    if not raw_blocks and not message_id:
        return None, None

    metadata_patch: dict[str, Any] = {"stream_state": stream_state}
    if stream_result.stop_reason:
        metadata_patch["stop_reason"] = stream_result.stop_reason
    if run_id:
        metadata_patch["run_id"] = run_id
    if thread_version is not None:
        metadata_patch["thread_version"] = int(thread_version)

    persisted_message_id = message_id

    if persisted_message_id:
        await asyncio.to_thread(
            update_message,
            persisted_message_id,
            content=raw_blocks,
            metadata_patch=metadata_patch,
        )
    else:
        if not raw_blocks:
            return None, None

        created = await asyncio.to_thread(
            create_message,
            session_id,
            "assistant",
            raw_blocks,
            metadata=metadata_patch,
        )
        persisted_message_id = str(created["id"])

    if stream_state == "streaming" or not persisted_message_id:
        return persisted_message_id, None

    raw_blocks = dedupe_collection_result_blocks(raw_blocks)
    raw_blocks, has_structured_refs = attach_structured_message_refs(
        raw_blocks,
        session_id=session_id,
    )
    has_runtime_refs = False
    if not has_structured_refs:
        raw_blocks, has_runtime_refs = attach_runtime_brand_refs(
            raw_blocks,
            session_id=session_id,
            request_query_text=request_query_text,
        )
    ref_enrichment_status = (
        "completed"
        if has_structured_refs or has_runtime_refs
        else "pending"
        if _should_schedule_ref_enrichment(raw_blocks)
        else "skipped"
    )
    await asyncio.to_thread(
        update_message,
        persisted_message_id,
        content=raw_blocks,
        metadata_patch={
            **metadata_patch,
            "ref_enrichment_status": ref_enrichment_status,
        },
    )
    reduced_execution_state = reduce_tool_result_blocks(raw_blocks)
    if reduced_execution_state:
        existing_runtime_state = await asyncio.to_thread(get_session_agent_runtime, session_id)
        existing_execution_state = (
            existing_runtime_state.get("execution_state", {})
            if isinstance(existing_runtime_state, dict)
            and isinstance(existing_runtime_state.get("execution_state"), dict)
            else {}
        )
        await asyncio.to_thread(
            merge_session_agent_runtime,
            session_id,
            {
                "execution_state": merge_execution_state(
                    existing_execution_state,
                    reduced_execution_state,
                ),
            },
        )
    return persisted_message_id, raw_blocks


def _should_schedule_ref_enrichment(blocks: list[dict[str, Any]]) -> bool:
    if not blocks:
        return False
    if any(
        isinstance(block, dict)
        and block.get("type") == "text"
        and isinstance(block.get("annotations"), list)
        and any(
            isinstance(annotation, dict) and annotation.get("type") == "message_ref_spans"
            for annotation in block.get("annotations", [])
        )
        for block in blocks
    ):
        return False
    has_text = any(
        isinstance(block, dict)
        and block.get("type") == "text"
        and str(block.get("text", "")).strip()
        for block in blocks
    )
    return has_text and bool(extract_collection_result_payloads(blocks))


def _build_ref_enriched_blocks(
    *,
    session_id: str,
    message_id: str,
    blocks: list[dict[str, Any]],
    request_query_text: str,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    bundle_artifact = _create_bundle_result_artifact(
        session_id=session_id,
        message_id=message_id,
        blocks=blocks,
    )
    if not bundle_artifact:
        bundle_artifact = maybe_materialize_style_bundle(
            session_id=session_id,
            message_id=message_id,
            blocks=blocks,
            request_query_text=request_query_text,
        )

    bundle_artifact_id = (
        str(bundle_artifact["artifact"]["id"])
        if isinstance(bundle_artifact, dict) and "artifact" in bundle_artifact
        else str(bundle_artifact["id"])
        if isinstance(bundle_artifact, dict) and bundle_artifact.get("id")
        else None
    )
    bundle_groups = None
    if isinstance(bundle_artifact, dict) and isinstance(bundle_artifact.get("groups"), list):
        bundle_groups = [dict(group) for group in bundle_artifact["groups"] if isinstance(group, dict)]

    finalized_blocks = append_collection_result_references(
        blocks,
        bundle_artifact_id=bundle_artifact_id,
        bundle_groups=bundle_groups,
    )
    finalized_blocks = attach_message_ref_spans(finalized_blocks)
    finalized_blocks = attach_search_plan_ref_spans(
        finalized_blocks,
        session_id=session_id,
        request_query_text=request_query_text,
    )

    metadata_patch: dict[str, Any] = {
        "ref_enrichment_status": "completed",
    }
    if bundle_artifact_id:
        metadata_patch["bundle_artifact_id"] = bundle_artifact_id
    return finalized_blocks, metadata_patch


def _launch_post_run_ref_enrichment(
    *,
    session_id: str,
    message_id: str | None,
    blocks: list[dict[str, Any]],
    request_query_text: str,
) -> None:
    if not message_id or not _should_schedule_ref_enrichment(blocks):
        return

    async def _run() -> None:
        try:
            logger.info("Starting detached ref enrichment for session %s", session_id)
            finalized_blocks, metadata_patch = await asyncio.wait_for(
                asyncio.to_thread(
                    _build_ref_enriched_blocks,
                    session_id=session_id,
                    message_id=message_id,
                    blocks=blocks,
                    request_query_text=request_query_text,
                ),
                timeout=REF_ENRICHMENT_TIMEOUT_SECONDS,
            )
        except asyncio.TimeoutError:
            logger.warning("Message ref enrichment timed out for session %s", session_id)
            await asyncio.to_thread(
                update_message,
                message_id,
                metadata_patch={"ref_enrichment_status": "timeout"},
            )
            return
        except Exception:
            logger.exception("Message ref enrichment failed for session %s", session_id)
            await asyncio.to_thread(
                update_message,
                message_id,
                metadata_patch={"ref_enrichment_status": "error"},
            )
            return

        await asyncio.to_thread(
            update_message,
            message_id,
            content=finalized_blocks,
            metadata_patch=metadata_patch,
        )
        logger.info("Completed detached ref enrichment for session %s", session_id)

    _track_detached_post_run_task(asyncio.create_task(_run()))


def _resolve_interrupted_execution_status(stream_result: StreamResult) -> str:
    return "completed" if _materialize_stream_blocks(stream_result) else "idle"


def _is_invalid_chat_history_error(error: Exception) -> bool:
    message = str(error)
    return (
        "INVALID_CHAT_HISTORY" in message
        or "do not have a corresponding ToolMessage" in message
    )


def _track_detached_post_run_task(task: asyncio.Task[Any]) -> None:
    _detached_post_run_tasks.add(task)

    def _cleanup(finished_task: asyncio.Task[Any]) -> None:
        _detached_post_run_tasks.discard(finished_task)
        try:
            exc = finished_task.exception()
        except asyncio.CancelledError:
            return
        if exc is not None:
            logger.error(
                "Detached post-run cleanup failed",
                exc_info=(type(exc), exc, exc.__traceback__),
            )

    task.add_done_callback(_cleanup)


def _launch_post_run_title_finalize(
    *,
    session_id: str,
    raw_content_blocks: list[dict[str, Any]],
    assistant_blocks: list[dict[str, Any]],
) -> None:
    async def _cleanup() -> None:
        if not assistant_blocks:
            return
        await asyncio.to_thread(
            finalize_session_title,
            session_id,
            raw_content_blocks,
            assistant_blocks,
        )

    _track_detached_post_run_task(asyncio.create_task(_cleanup()))


def _summarize_tool_payload(payload: dict[str, Any]) -> str:
    action = str(payload.get("action", "")).strip()
    if action == "show_collection":
        total = payload.get("total", 0)
        filters = payload.get("filters_applied", [])
        filters_text = ", ".join(str(item) for item in filters[:4]) if isinstance(filters, list) else ""
        return f"展示检索结果 {total} 张" + (f"，过滤条件：{filters_text}" if filters_text else "")

    primary_style = payload.get("primary_style")
    if isinstance(primary_style, dict) and primary_style.get("style_name"):
        style_name = str(primary_style.get("style_name", "")).strip()
        retrieval_plan = payload.get("retrieval_plan", {})
        query_en = ""
        if isinstance(retrieval_plan, dict):
            query_en = str(retrieval_plan.get("retrieval_query_en", "")).strip()
        return f"识别核心风格 {style_name}" + (f"，英文检索词：{query_en}" if query_en else "")

    analysis = payload.get("analysis")
    if isinstance(analysis, dict):
        summary = str(analysis.get("summary_zh", "")).strip()
        query_en = str(analysis.get("retrieval_query_en", "")).strip()
        if summary or query_en:
            return f"视觉分析：{summary}" + (f"；英文检索词：{query_en}" if query_en else "")

    message = str(payload.get("message", "")).strip()
    if message:
        return message

    status = str(payload.get("status", "")).strip()
    if status:
        return f"工具返回状态：{status}"

    return ""


def _summarize_blocks_for_bootstrap(blocks: list[dict[str, Any]]) -> str:
    text = " ".join(_extract_text_from_blocks(blocks).split())
    if text:
        return text

    for block in blocks:
        if not isinstance(block, dict) or block.get("type") != "tool_result":
            continue

        content = block.get("content")
        if not isinstance(content, str) or not content:
            continue

        try:
            payload = json.loads(content)
        except json.JSONDecodeError:
            payload = None

        if isinstance(payload, dict):
            summary = _summarize_tool_payload(payload)
            if summary:
                return summary

    return ""


def _extract_category_hints_from_payload(payload: dict[str, Any]) -> list[str]:
    hints: list[str] = []

    direct_fields = [
        payload.get("resolved_category"),
        payload.get("resolved_category_hint"),
    ]
    for value in direct_fields:
        if isinstance(value, str) and value.strip():
            hints.append(value.strip().lower())

    filter_lists = [
        payload.get("active_filters"),
        payload.get("filters_applied"),
    ]
    for items in filter_lists:
        if not isinstance(items, list):
            continue
        for raw in items:
            if not isinstance(raw, str):
                continue
            item = raw.strip().lower()
            if item.startswith("category="):
                hints.append(item.split("=", 1)[1].strip())
            elif ":" in item:
                hints.append(item.split(":", 1)[0].strip())

    return list(dict.fromkeys([hint for hint in hints if hint]))


def _extract_style_hints_from_payload(payload: dict[str, Any]) -> tuple[str, str, str]:
    primary_style = payload.get("primary_style")
    retrieval_plan = payload.get("retrieval_plan")

    style_name = ""
    if isinstance(primary_style, dict):
        style_name = str(primary_style.get("style_name", "")).strip()

    retrieval_query = ""
    if isinstance(retrieval_plan, dict):
        retrieval_query = str(retrieval_plan.get("retrieval_query_en", "")).strip()

    rich_text = str(payload.get("rich_text", "")).strip()
    if not rich_text and isinstance(retrieval_plan, dict):
        rich_text = str(retrieval_plan.get("style_rich_text", "")).strip()

    return style_name, retrieval_query, rich_text


async def _restore_agent_session_from_history(
    thread_id: str,
    history: list[dict[str, Any]],
    *,
    thread_version: int,
) -> dict[str, Any] | None:
    """Hydrate agent session state from the latest persisted show_collection result.

    This keeps multi-turn retrieval stable even if the next request lands on a
    different worker process, where in-memory agent session state would be empty.
    """
    if not history:
        return None

    for message in reversed(history):
        metadata = message.get("metadata", {})
        message_thread_version = None
        if isinstance(metadata, dict):
            raw_thread_version = metadata.get("thread_version")
            try:
                message_thread_version = int(raw_thread_version) if raw_thread_version not in (None, "") else None
            except (TypeError, ValueError):
                message_thread_version = None

        if message_thread_version is None and thread_version > 1:
            continue
        if message_thread_version is not None and message_thread_version != thread_version:
            continue

        blocks = message.get("content", [])
        if not isinstance(blocks, list):
            continue

        for block in reversed(blocks):
            if not isinstance(block, dict) or block.get("type") != "tool_result":
                continue

            content = block.get("content", "")
            if not isinstance(content, str) or not content:
                continue

            try:
                payload = json.loads(content)
            except json.JSONDecodeError:
                continue

            category_hints = _extract_category_hints_from_payload(payload)
            if len(category_hints) == 1:
                update_session_semantics(
                    thread_id=thread_id,
                    explicit_category=category_hints[0],
                )
            style_name, retrieval_query, style_rich_text = _extract_style_hints_from_payload(payload)
            if style_name or retrieval_query or style_rich_text:
                update_session_semantics(
                    thread_id=thread_id,
                    explicit_style_name=style_name or None,
                    style_retrieval_query=retrieval_query or None,
                    style_rich_text=style_rich_text or None,
                )
                if retrieval_query or style_rich_text:
                    remember_session_style(
                        thread_id,
                        style_retrieval_query=retrieval_query,
                        style_rich_text=style_rich_text,
                        style_name=style_name,
                    )

            if payload.get("action") != "show_collection":
                continue

            search_request_id = str(payload.get("search_request_id", "")).strip()
            if not search_request_id:
                continue

            artifact = await asyncio.to_thread(
                get_artifact,
                search_request_id,
                artifact_type="collection_result",
            )
            if not artifact:
                continue

            session = artifact.get("metadata", {}).get("search_session")
            if not isinstance(session, dict):
                continue

            config = {"configurable": {"thread_id": thread_id}}
            set_agent_session(config, session)
            update_session_semantics(
                thread_id=thread_id,
                query_text=str(session.get("query", "")),
                session_filters=session.get("filters", []),
            )
            return session

    return None


def _restore_agent_session_from_runtime_state(
    *,
    session_id: str,
    thread_id: str,
) -> dict[str, Any] | None:
    runtime_state = get_session_agent_runtime(session_id)
    if not isinstance(runtime_state, dict) or not runtime_state:
        return None

    session = runtime_state.get("search_session")
    if not isinstance(session, dict):
        return None

    config = {"configurable": {"thread_id": thread_id}}
    set_agent_session(config, session)

    semantics = runtime_state.get("semantics")
    if isinstance(semantics, dict) and semantics:
        set_session_semantics(thread_id, semantics)
    else:
        update_session_semantics(
            thread_id=thread_id,
            query_text=str(session.get("query", "")),
            session_filters=session.get("filters", []),
        )

    if isinstance(semantics, dict):
        style_retrieval_query = str(semantics.get("style_retrieval_query", "")).strip()
        style_name = str(semantics.get("primary_style_name", "")).strip()
        style_rich_text = str(semantics.get("style_rich_text", "")).strip()
        if style_retrieval_query or style_rich_text:
            remember_session_style(
                thread_id,
                style_retrieval_query=style_retrieval_query,
                style_rich_text=style_rich_text,
                style_name=style_name,
            )
        vision_retrieval_query = str(semantics.get("vision_retrieval_query", "")).strip()
        vision_summary_zh = str(semantics.get("vision_summary_zh", "")).strip()
        vision_primary_category = str(semantics.get("primary_category", "")).strip().lower()
        if vision_retrieval_query or vision_summary_zh or vision_primary_category:
            remember_session_vision(
                thread_id,
                vision_retrieval_query=vision_retrieval_query,
                vision_summary_zh=vision_summary_zh,
                vision_primary_category=vision_primary_category,
            )

    runtime_plan = runtime_state.get("runtime_plan")
    if isinstance(runtime_plan, dict) and runtime_plan:
        set_runtime_plan(thread_id, get_runtime_plan_from_payload(runtime_plan))

    return session


def _to_anthropic_content_blocks(blocks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Convert persisted blocks to Anthropic-compatible user content blocks."""
    anthropic_blocks: list[dict[str, Any]] = []

    for block in blocks:
        block_type = block.get("type")

        if block_type == "text":
            text = str(block.get("text", ""))
            if text:
                anthropic_blocks.append({"type": "text", "text": text})
            continue

        if block_type == "image":
            source = block.get("source")
            if not isinstance(source, dict):
                continue

            source_type = source.get("type")
            if source_type == "base64":
                media_type = str(source.get("media_type", "")).strip()
                data = str(source.get("data", "")).strip()
                if media_type and data:
                    anthropic_blocks.append({
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": media_type,
                            "data": data,
                        },
                    })
            elif source_type == "url":
                url = str(source.get("url", "")).strip()
                if url:
                    anthropic_blocks.append({
                        "type": "image",
                        "source": {
                            "type": "url",
                            "url": url,
                        },
                    })
            continue

        if block_type == "document":
            source = block.get("source")
            if not isinstance(source, dict):
                continue
            source_type = source.get("type")
            if source_type == "url":
                url = str(source.get("url", "")).strip()
                if url:
                    anthropic_blocks.append({
                        "type": "document",
                        "source": {"type": "url", "url": url},
                    })
            elif source_type == "file":
                file_id = str(source.get("file_id", "")).strip()
                if file_id:
                    anthropic_blocks.append({
                        "type": "document",
                        "source": {"type": "file", "file_id": file_id},
                    })

    return anthropic_blocks


async def _build_query_context(blocks: list[dict[str, Any]]) -> dict[str, Any] | None:
    image_embeddings: list[list[float]] = []

    for block in blocks:
        if block.get("type") != "image":
            continue

        source = block.get("source")
        if not isinstance(source, dict):
            continue

        source_type = source.get("type")
        try:
            if source_type == "base64":
                image_embeddings.append(await asyncio.to_thread(
                    encode_image,
                    image_base64=str(source.get("data", "")),
                    media_type=str(source.get("media_type", "image/jpeg")),
                ))
            elif source_type == "url":
                image_embeddings.append(await asyncio.to_thread(
                    encode_image,
                    image_url=str(source.get("url", "")),
                    media_type=str(block.get("mime_type", "image/jpeg")),
                ))
        except Exception:
            continue

    if not image_embeddings:
        return None

    return {
        "image_embeddings": image_embeddings,
        "image_count": len(image_embeddings),
    }


def _compose_agent_input(
    blocks: list[dict[str, Any]],
    *,
    fallback_image_count: int = 0,
    turn_playbook: str = "",
    intent_brief: str = "",
    execution_state: str = "",
    planner_frame: str = "",
    runtime_plan: str = "",
    compaction_bootstrap: str = "",
    session_preferences: str = "",
) -> str:
    image_count = len(_extract_image_blocks(blocks))
    text = _extract_text_from_blocks(blocks)
    prefix_parts = []
    if turn_playbook:
        prefix_parts.append(turn_playbook)
    if intent_brief:
        prefix_parts.append(intent_brief)
    if execution_state:
        prefix_parts.append(execution_state)
    if planner_frame:
        prefix_parts.append(planner_frame)
    if runtime_plan:
        prefix_parts.append(runtime_plan)
    prefix_parts.append(_format_inline_ref_protocol())
    if compaction_bootstrap:
        prefix_parts.append(compaction_bootstrap)
    if session_preferences:
        prefix_parts.append(session_preferences)
    prefix = "\n\n".join(prefix_parts)
    prefix = f"{prefix}\n\n" if prefix else ""

    if image_count > 0:
        hint = (
            f"[系统提示：当前消息包含 {image_count} 张用户刚上传的图片。"
            "检索工具可直接使用这些图片的向量进行搜索。"
            "不要说用户没有上传图片。若无额外文字约束，可直接调用 start_collection(\"\")。]"
        )
        body = f"{text}\n\n{hint}" if text else hint
        return f"{prefix}{body}" if prefix else body

    if fallback_image_count > 0:
        hint = (
            f"[系统提示：本会话最近一次上传的 {fallback_image_count} 张图片仍可用于当前这轮检索。"
            "检索工具可直接使用这些已上传图片的向量。"
            "不要说用户没有上传图片。若用户要求继续基于上一张图检索，可直接调用 start_collection(query=用户补充条件或空字符串)。]"
        )
        body = f"{text}\n\n{hint}" if text else hint
        return f"{prefix}{body}" if prefix else body

    return f"{prefix}{text}" if prefix else text


def _format_session_preferences(preferences: dict[str, Any] | None) -> str:
    payload = dict(preferences or {})
    gender = str(payload.get("gender") or "").strip().lower()
    quarter = str(payload.get("quarter") or "").strip()
    year = payload.get("year")
    taste_profile_id = str(payload.get("taste_profile_id") or "").strip()
    taste_profile_weight = payload.get("taste_profile_weight")

    if not any([gender, quarter, year, taste_profile_id]):
        return ""

    gender_label = "女装" if gender == "female" else "男装" if gender == "male" else ""
    lines = [
        "[SESSION_PREFERENCES]",
        "以下是本会话的默认检索偏好。除非用户本轮明确覆盖，否则请将其视为隐含约束并在检索时优先沿用：",
    ]
    if gender_label:
        lines.append(f"- 性别偏好：{gender_label}")
    if quarter:
        lines.append(f"- 季度偏好：{quarter}")
    if year not in (None, ""):
        lines.append(f"- 年份偏好：{year}")
    if taste_profile_id:
        weight = 0.0
        try:
            weight = float(taste_profile_weight)
        except (TypeError, ValueError):
            weight = 0.0
        lines.append(f"- 偏好图集排序：已启用（权重 {int(round(weight * 100))}%）")
    lines.append("若用户本轮消息给出了新的明确限定，以用户当前消息为准。")
    return "\n".join(lines)


def _format_inline_ref_protocol() -> str:
    example = json.dumps({
        "items": [
            {
                "quote": "Akris 的连衣裙",
                "label": "Akris 连衣裙",
                "query": "sculptural red dress luxury editorial",
                "brand": "Akris",
                "categories": ["dress"],
                "quarter": "秋冬",
            }
        ]
    }, ensure_ascii=False)
    return "\n".join([
        "[INLINE_REF_PROTOCOL]",
        "当你在最终回答中提到一个值得用户点击继续看图的品牌 / 方向 / 推荐句时，可在答案末尾追加一个隐藏的结构化 ref 块。",
        f"使用格式：\n{REFS_START_MARKER}{example}{REFS_END_MARKER}",
        "并且必须包在 [AIMODA_REFS] 与 [/AIMODA_REFS] 之间。",
        "规则：",
        "1. `quote` 必须是你正文里原样出现的连续短语。",
        "2. 对 drawer 类 ref，采用‘语义 query + 硬过滤’：brand / gender / quarter / year_min 直接作为硬过滤；主要检索意图写进 query。",
        "3. 若推荐的是新品牌/新方向，不要复用旧结果集；直接给新的 query/filter 计划。",
        "4. 只给少量高价值 ref，宁缺毋滥。",
        "5. 若没有可靠 ref，就不要输出这个块。",
        "[/INLINE_REF_PROTOCOL]",
    ])


def _format_compaction_bootstrap(bootstrap: dict[str, Any] | None) -> str:
    if not bootstrap:
        return ""

    summary = bootstrap.get("summary", {})
    summary_text = str(summary.get("summary", "")).strip() if isinstance(summary, dict) else ""
    recent_messages = bootstrap.get("recent_messages", [])
    if not summary_text and not recent_messages:
        return ""

    lines = ["[COMPACT_CONVERSATION]"]
    if summary_text:
        lines.append("以下是本会话较早轮次的压缩摘要，请继承其上下文继续完成当前任务：")
        lines.append(summary_text)

    if isinstance(recent_messages, list) and recent_messages:
        lines.append("以下是最近保留的原始轮次：")
        for idx, message in enumerate(recent_messages[-6:], start=1):
            if not isinstance(message, dict):
                continue
            role = "用户" if message.get("role") == "user" else "助手"
            text = _summarize_blocks_for_bootstrap(message.get("content", []))
            if text:
                lines.append(f"{idx}. {role}：{text[:280]}")

    lines.append("[/COMPACT_CONVERSATION]")
    return "\n".join(lines)


# ── Chat endpoints ──

@router.post("")
async def chat_endpoint(
    req: ChatRequest,
    user: Annotated[AuthenticatedUser, Depends(get_current_user)],
):
    """Stream agent response as SSE events in real-time.

    Requires JWT authentication. Each message is tied to a session
    which persists conversation history via LangGraph checkpointer.
    Messages are also persisted to the messages table for history recall.
    """
    agent = await get_agent()
    session = await asyncio.to_thread(get_session, req.session_id)
    if not session or session.get("user_id") != user.id:
        return JSONResponse(
            status_code=404,
            content={"success": False, "error": "会话不存在"},
        )

    raw_content_blocks = _normalize_message_content(req.content)
    if not raw_content_blocks:
        return JSONResponse(
            status_code=400,
            content={"success": False, "error": "消息内容不能为空"},
        )

    access = await asyncio.to_thread(get_feature_access_status, user, "ai_chat")
    if not access.allowed:
        return JSONResponse(
            status_code=403,
            content={
                "success": False,
                "error": "AI 助手次数已用尽，请开通会员或兑换订阅后继续使用",
                "data": {"feature": access.model_dump(by_alias=True)},
            },
        )

    active_run = await chat_run_registry.get_session_run(req.session_id)
    if active_run and active_run.user_id == user.id:
        return JSONResponse(
            status_code=409,
            content={"success": False, "error": "当前会话仍在执行中，请先停止或等待完成"},
        )

    access = await asyncio.to_thread(
        consume_feature_access,
        user,
        "ai_chat",
        metadata={"session_id": req.session_id},
    )

    await asyncio.to_thread(maybe_compact_session, req.session_id, user.id)
    session = await asyncio.to_thread(get_session, req.session_id)
    if not session or session.get("user_id") != user.id:
        return JSONResponse(
            status_code=404,
            content={"success": False, "error": "会话不存在"},
        )

    thread_id = get_thread_id(user.id, req.session_id, int(session.get("thread_version", 1) or 1))
    compaction_bootstrap = await asyncio.to_thread(
        get_compaction_bootstrap_payload,
        req.session_id,
        user.id,
        thread_version=int(session.get("thread_version", 1) or 1),
    )

    content_blocks = await asyncio.to_thread(
        _persist_inline_media_blocks,
        req.session_id,
        raw_content_blocks,
    )

    restored_agent_session = await asyncio.to_thread(
        _restore_agent_session_from_runtime_state,
        session_id=req.session_id,
        thread_id=thread_id,
    )
    if not restored_agent_session:
        restored_agent_session = await _restore_agent_session_from_history(
            thread_id,
            req.history,
            thread_version=int(session.get("thread_version", 1) or 1),
        )

    image_blocks = _extract_image_blocks(raw_content_blocks)
    query_text = _extract_text_from_blocks(raw_content_blocks)
    current_query_context = await _build_query_context(raw_content_blocks)
    if current_query_context and image_blocks:
        remember_session_images(
            thread_id,
            image_blocks=image_blocks,
            context=current_query_context,
        )
    existing_agent_session = restored_agent_session or get_agent_session({"configurable": {"thread_id": thread_id}})
    session_semantics = get_session_semantics(thread_id)
    runtime_state_snapshot = await asyncio.to_thread(get_session_agent_runtime, req.session_id)
    execution_state_snapshot = (
        runtime_state_snapshot.get("execution_state", {})
        if isinstance(runtime_state_snapshot, dict) and isinstance(runtime_state_snapshot.get("execution_state"), dict)
        else {}
    )
    fallback_image_blocks = [] if image_blocks else get_session_image_blocks(thread_id)
    turn_context = build_turn_context(
        query_text=query_text,
        has_images=bool(image_blocks or fallback_image_blocks),
        session_filters=existing_agent_session.get("filters", []),
        session_active=bool(existing_agent_session.get("active")),
        session_primary_category=session_semantics.get("primary_category"),
    )
    set_turn_context(thread_id, turn_context)
    runtime_plan = build_runtime_plan(
        query_text=query_text,
        has_images=bool(image_blocks or fallback_image_blocks),
        session_filters=existing_agent_session.get("filters", []),
        session_active=bool(existing_agent_session.get("active")),
        session_primary_category=session_semantics.get("primary_category"),
        session_preferences=session.get("preferences") if isinstance(session, dict) else None,
        session_semantics=session_semantics,
        previous_plan=get_runtime_plan(thread_id),
    )
    set_runtime_plan(thread_id, runtime_plan)
    intent_brief = build_intent_brief(
        query_text=query_text,
        has_images=bool(image_blocks or fallback_image_blocks),
        session_active=bool(existing_agent_session.get("active")),
        turn_context=turn_context,
        runtime_plan=runtime_plan,
        session_semantics=session_semantics,
    )
    planner_frame = build_planner_frame(
        runtime_plan=runtime_plan,
        intent_brief=intent_brief,
        execution_state=execution_state_snapshot,
    )
    agent_input = _compose_agent_input(
        raw_content_blocks,
        fallback_image_count=len(fallback_image_blocks),
        turn_playbook=build_turn_playbook(turn_context),
        intent_brief=format_intent_brief(intent_brief),
        execution_state=format_execution_state(execution_state_snapshot),
        planner_frame=format_planner_frame(planner_frame),
        runtime_plan=format_runtime_plan(runtime_plan),
        compaction_bootstrap=_format_compaction_bootstrap(compaction_bootstrap),
        session_preferences=_format_session_preferences(session.get("preferences")),
    )
    query_context = merge_query_contexts(
        get_session_query_context(thread_id),
        current_query_context,
    )
    set_query_context(thread_id, query_context)
    run_id = str(uuid.uuid4())

    # Touch session + auto-title (run sync DB ops in thread pool)
    await asyncio.to_thread(touch_session, req.session_id)
    await asyncio.to_thread(auto_title_session, req.session_id, raw_content_blocks)
    await asyncio.to_thread(
        set_session_execution_status,
        req.session_id,
        execution_status="running",
        run_id=run_id,
    )

    await asyncio.to_thread(
        create_message,
        req.session_id,
        "user",
        content_blocks,
        metadata={"thread_version": int(session.get("thread_version", 1) or 1)},
    )

    # Create StreamResult to collect full assistant text
    stream_result = StreamResult()
    assistant_message_id: str | None = None
    last_completed_blocks: list[dict[str, Any]] | None = None
    last_persisted_snapshot = ""
    last_persist_at = 0.0

    async def _sync_assistant_progress(*, force: bool = False, stream_state: str = "streaming") -> None:
        nonlocal assistant_message_id, last_completed_blocks, last_persisted_snapshot, last_persist_at

        blocks = _materialize_stream_blocks(stream_result)
        if not blocks and not assistant_message_id and stream_state == "streaming":
            return

        snapshot = json.dumps(blocks, ensure_ascii=False)
        now = time.monotonic()
        if (
            not force
            and stream_state == "streaming"
            and snapshot == last_persisted_snapshot
            and (now - last_persist_at) < 0.35
        ):
            return

        assistant_message_id, finalized_blocks = await _persist_streaming_assistant_message(
            session_id=req.session_id,
            message_id=assistant_message_id,
            stream_result=stream_result,
            stream_state=stream_state,
            run_id=run_id,
            thread_version=int(session.get("thread_version", 1) or 1),
            request_query_text=query_text,
        )
        if finalized_blocks is not None:
            last_completed_blocks = finalized_blocks
        last_persisted_snapshot = snapshot
        last_persist_at = now

    event_queue: asyncio.Queue[str | None] = asyncio.Queue()
    client_connected = True

    def _enqueue_stream_chunk(chunk: str | None) -> None:
        if not client_connected and chunk is not None:
            return
        event_queue.put_nowait(chunk)

    async def _run_stream() -> None:
        """Run the stream in the background so UI refreshes do not abort execution."""
        try:
            async for chunk in stream_agent_response(
                agent=agent,
                message=agent_input,
                history=req.history,
                thread_id=thread_id,
                run_id=run_id,
                result=stream_result,
            ):
                _enqueue_stream_chunk(chunk)
                await _sync_assistant_progress()

            # After streaming completes, persist assistant message using ContentBlocks
            if stream_result.content_blocks:
                await _sync_assistant_progress(force=True, stream_state="completed")
                if last_completed_blocks:
                    _enqueue_stream_chunk(sse_event({
                        "type": "message_finalized",
                        "content": last_completed_blocks,
                    }))
            await asyncio.to_thread(
                set_session_execution_status,
                req.session_id,
                execution_status="completed",
                run_id=run_id,
            )
            _launch_post_run_ref_enrichment(
                session_id=req.session_id,
                message_id=assistant_message_id,
                blocks=list(last_completed_blocks or stream_result.content_blocks),
                request_query_text=query_text,
            )
            await asyncio.to_thread(
                clear_compaction_bootstrap,
                req.session_id,
                thread_version=int(session.get("thread_version", 1) or 1),
            )
            _launch_post_run_title_finalize(
                session_id=req.session_id,
                raw_content_blocks=raw_content_blocks,
                assistant_blocks=list(stream_result.content_blocks),
            )
        except (asyncio.CancelledError, ChatRunCancelledError):
            await _sync_assistant_progress(force=True, stream_state="interrupted")
            await asyncio.to_thread(
                set_session_execution_status,
                req.session_id,
                execution_status=_resolve_interrupted_execution_status(stream_result),
                run_id=run_id,
            )
            await asyncio.to_thread(
                clear_compaction_bootstrap,
                req.session_id,
                thread_version=int(session.get("thread_version", 1) or 1),
            )
            _launch_post_run_title_finalize(
                session_id=req.session_id,
                raw_content_blocks=raw_content_blocks,
                assistant_blocks=list(stream_result.content_blocks),
            )
        except Exception as exc:
            import traceback
            traceback.print_exc()
            invalid_history_repaired = False
            error_message = "Agent stream failed. Check server logs."
            if _is_invalid_chat_history_error(exc):
                next_thread_version = await asyncio.to_thread(
                    reset_session_runtime_checkpoint,
                    req.session_id,
                )
                invalid_history_repaired = next_thread_version is not None
                error_message = (
                    "检测到会话运行时历史损坏，已自动重置当前会话线程。请重新发送上一条消息。"
                    if invalid_history_repaired
                    else "检测到会话运行时历史损坏，请刷新后重试。"
                )
            await _sync_assistant_progress(force=True, stream_state="error")
            await asyncio.to_thread(
                clear_compaction_bootstrap,
                req.session_id,
                thread_version=int(session.get("thread_version", 1) or 1),
            )
            await asyncio.to_thread(
                set_session_execution_status,
                req.session_id,
                execution_status="error",
                run_id=run_id,
                error_message=error_message,
            )
            _enqueue_stream_chunk(sse_event({"type": "error", "message": error_message}))
        finally:
            set_query_context(thread_id, None)
            clear_turn_context(thread_id)
            _enqueue_stream_chunk(None)

    stream_task = asyncio.create_task(_run_stream())
    await chat_run_registry.register(
        session_id=req.session_id,
        user_id=user.id,
        run_id=run_id,
        task=stream_task,
    )

    async def _generate() -> AsyncGenerator[str, None]:
        nonlocal client_connected
        try:
            while True:
                chunk = await event_queue.get()
                if chunk is None:
                    break
                yield chunk
        except asyncio.CancelledError:
            client_connected = False
            raise
        finally:
            client_connected = False

    return StreamingResponse(
        _generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
            "X-Aimoda-Feature-Remaining": str(access.remaining_count),
            "X-Aimoda-Run-Id": run_id,
        },
    )


@router.post("/sessions/{session_id}/stop")
async def stop_session_run(
    session_id: str,
    body: StopSessionRunRequest,
    user: Annotated[AuthenticatedUser, Depends(get_current_user)],
):
    session = await asyncio.to_thread(get_session, session_id)
    if not session or session.get("user_id") != user.id:
        return JSONResponse(
            status_code=404,
            content={"success": False, "error": "会话不存在"},
        )

    stopped = await chat_run_registry.stop_session(
        session_id=session_id,
        user_id=user.id,
        run_id=body.run_id,
    )

    if stopped:
        await asyncio.to_thread(
            set_session_execution_status,
            session_id,
            execution_status="stopping",
            run_id=body.run_id,
        )

    return {
        "success": True,
        "data": {
            "session_id": session_id,
            "run_id": body.run_id,
            "stopped": stopped,
            "execution_status": "stopping" if stopped else session.get("execution_status", "idle"),
        },
    }


@router.post("/search_session")
@router.post("/search_session_by_id")
async def search_session_endpoint(
    req: SearchSessionRequest,
    user: Annotated[AuthenticatedUser, Depends(get_current_user)],
):
    """Search using the session state directly for Drawer pagination."""
    artifact = await asyncio.to_thread(
        get_artifact,
        req.search_request_id,
        artifact_type="collection_result",
    )
    if not artifact:
        raise HTTPException(status_code=404, detail="Search request not found")

    artifact_session = await asyncio.to_thread(get_session, artifact["session_id"])
    if not artifact_session or artifact_session.get("user_id") != user.id:
        raise HTTPException(status_code=404, detail="Search request not found")

    session = artifact.get("metadata", {}).get("search_session")
    if not isinstance(session, dict):
        raise HTTPException(status_code=400, detail="Invalid search request payload")

    client = get_qdrant()
    total = count_session(client, session)
    effective_session = dict(session)
    effective_query_vector, effective_vector_type = apply_taste_profile_to_query(
        user.id,
        req.taste_profile_id,
        query_vector=(
            list(session.get("q_emb"))
            if isinstance(session.get("q_emb"), list)
            else None
        ),
        query_vector_type=str(session.get("vector_type") or "").strip() or None,
        blend_weight=req.taste_profile_weight if req.taste_profile_weight is not None else 0.24,
    )
    effective_session["q_emb"] = effective_query_vector
    if effective_vector_type:
        effective_session["vector_type"] = effective_vector_type

    page = get_session_page(client, effective_session, offset=req.offset, limit=req.limit)
    formatted_page = _annotate_catalog_images_for_user(
        user.id,
        _format_candidate_payloads(_payload_candidates_from_points(page)),
    )

    return {
        "images": formatted_page,
        "total": total,
        "offset": req.offset,
        "limit": req.limit,
        "has_more": req.offset + req.limit < total,
    }


@router.post("/resolve_search_plan_ref")
async def resolve_search_plan_ref_endpoint(
    req: ResolveSearchPlanRefRequest,
    user: Annotated[AuthenticatedUser, Depends(get_current_user)],
):
    try:
        payload = await asyncio.to_thread(
            materialize_search_plan_ref,
            user_id=user.id,
            session_id=req.session_id,
            current_session_id=req.current_session_id,
            plan=req.model_dump(),
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    return {"data": payload}


@router.get("/artifacts/{artifact_id}")
async def get_chat_artifact_endpoint(
    artifact_id: str,
    user: Annotated[AuthenticatedUser, Depends(get_current_user)],
):
    artifact = await asyncio.to_thread(get_artifact, artifact_id)
    if not artifact:
        return JSONResponse(
            status_code=404,
            content={"success": False, "error": "结果不存在"},
        )

    session = await asyncio.to_thread(get_session, artifact["session_id"])
    if not session or session.get("user_id") != user.id:
        return JSONResponse(
            status_code=404,
            content={"success": False, "error": "结果不存在"},
        )

    return {"success": True, "data": artifact}


# ── Single image detail endpoint ──

@router.get("/image/{image_id}")
async def get_image_detail(
    image_id: str,
    user: Annotated[AuthenticatedUser, Depends(get_current_user)],
):
    """Get a single image's full details by ID from Qdrant."""
    client = get_qdrant()
    collection = get_collection()

    try:
        from ..agent.qdrant_utils import format_result as _format_result
        points = client.retrieve(
            collection_name=collection,
            ids=[image_id],
            with_payload=True,
        )
        if not points:
            raise HTTPException(status_code=404, detail="Image not found")

        item = _format_result(points[0].payload, 0)
        item.pop("garments_raw", None)
        item.pop("extracted_colors_raw", None)
        annotated = _annotate_catalog_images_for_user(user.id, [item])
        return annotated[0] if annotated else item
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to retrieve image: {e}")


@router.delete("/image/{image_id}")
async def delete_image_detail(
    image_id: str,
    _admin: Annotated[AuthenticatedUser, Depends(require_role(["admin"]))],
):
    """Delete a catalog image from Qdrant and clean up favorite references."""
    try:
        deleted = await asyncio.to_thread(catalog_image_service.delete_catalog_image, image_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete image: {e}") from e

    if not deleted:
        raise HTTPException(status_code=404, detail="Image not found")

    return {"success": True, "data": deleted}


# ── Image detail inline search endpoints ──

# Mapping from top_category to Qdrant named vector
_TOP_CATEGORY_TO_VECTOR = {
    "tops": "upper",
    "bottoms": "lower",
    "full": "garment",
}

class SearchSimilarRequest(BaseModel):
    """Brand / garment tag / category filter search."""
    brand: str | None = None
    categories: list[str] | None = None
    garment_tags: list[str] | None = None
    image_id: str | None = None
    top_category: str | None = None  # tops / bottoms / full → chooses named vector
    gender: str | None = None  # hard filter: female / male
    quarter: str | None = None
    page: int = 1
    page_size: int = 50
    taste_profile_id: str | None = None
    taste_profile_weight: float | None = None


class SearchByColorRequest(BaseModel):
    """Color similarity search by hex value."""
    hex: str
    color_name: str = ""
    threshold: float = 80.0
    min_percentage: float = 0.0
    gender: str | None = None
    quarter: str | None = None
    page: int = 1
    page_size: int = 50
    taste_profile_id: str | None = None
    taste_profile_weight: float | None = None


def _scroll_filtered_page(
    *,
    client: Any,
    collection_name: str,
    scroll_filter: Any,
    offset: int,
    limit: int,
    with_payload: bool = True,
):
    """Adapt cursor-based Qdrant scrolling to the page-based API used by the UI."""
    if offset <= 0:
        records, _ = client.scroll(
            collection_name=collection_name,
            scroll_filter=scroll_filter,
            limit=limit,
            with_payload=with_payload,
        )
        return records

    remaining = offset
    cursor: Any = None

    while remaining > 0:
        batch_size = min(remaining, 256)
        skipped, next_cursor = client.scroll(
            collection_name=collection_name,
            scroll_filter=scroll_filter,
            limit=batch_size,
            offset=cursor,
            with_payload=False,
        )
        skipped_count = len(skipped)
        if skipped_count == 0:
            return []
        remaining -= skipped_count
        cursor = next_cursor
        if remaining > 0 and cursor is None:
            return []

    if cursor is None:
        return []

    records, _ = client.scroll(
        collection_name=collection_name,
        scroll_filter=scroll_filter,
        limit=limit,
        offset=cursor,
        with_payload=with_payload,
    )
    return records


def _candidate_limit(total: int, offset: int, limit: int) -> int:
    if total <= 0:
        return 0
    return min(total, max(offset + (limit * 6), 96))


def _payload_candidates_from_points(points: list[Any]) -> list[dict[str, Any]]:
    candidates: list[dict[str, Any]] = []
    for index, point in enumerate(points):
        payload = dict(getattr(point, "payload", {}) or {})
        image_id = str(getattr(point, "id", "") or payload.get("image_id") or "")
        if not image_id:
            continue
        payload.setdefault("image_id", image_id)
        candidates.append(
            {
                "image_id": image_id,
                "payload": payload,
                "base_score": getattr(point, "score", None),
                "base_rank": index,
            }
        )
    return candidates


def _format_candidate_payloads(candidates: list[dict[str, Any]]) -> list[dict[str, Any]]:
    formatted: list[dict[str, Any]] = []
    for candidate in candidates:
        item = format_result(candidate["payload"], candidate.get("base_score") or 0)
        item.pop("garments_raw", None)
        item.pop("extracted_colors_raw", None)
        formatted.append(item)
    return formatted


def _annotate_catalog_images_for_user(
    user_id: int,
    images: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    if not images:
        return images
    try:
        return annotate_catalog_image_results(user_id, images)
    except Exception:
        return images


@router.post("/search_similar")
async def search_similar_endpoint(
    req: SearchSimilarRequest,
    user: Annotated[AuthenticatedUser, Depends(get_current_user)],
):
    """Search images by garment vector similarity + category filter."""
    from ..agent.qdrant_utils import build_qdrant_filter, format_result as _format_result

    try:
        client = get_qdrant()
        collection = get_collection()

        qdrant_filter = build_qdrant_filter(
            brand=req.brand,
            categories=req.categories,
            garment_tags=req.garment_tags,
            gender=req.gender,
            quarter=req.quarter,
        )

        offset = (req.page - 1) * req.page_size

        # Determine which named vector to use based on top_category
        vector_name = _TOP_CATEGORY_TO_VECTOR.get(req.top_category or "", "garment")
        query_vector = None

        if req.image_id:
            try:
                # Request both the target vector AND garment as fallback
                vectors_to_fetch = [vector_name]
                if vector_name != "garment":
                    vectors_to_fetch.append("garment")

                point_info = await asyncio.wait_for(
                    asyncio.to_thread(
                        client.retrieve,
                        collection_name=collection,
                        ids=[req.image_id],
                        with_vectors=vectors_to_fetch,
                    ),
                    timeout=15.0,
                )
                if point_info and hasattr(point_info[0], "vector") and isinstance(point_info[0].vector, dict):
                    query_vector = point_info[0].vector.get(vector_name)
                    if query_vector:
                        print(f"[search_similar] Got {vector_name} vector ({len(query_vector)}d) for {req.image_id}")
                    else:
                        # Fallback to garment vector
                        query_vector = point_info[0].vector.get("garment")
                        if query_vector:
                            vector_name = "garment"
                            print(f"[search_similar] Using garment fallback vector")
                        else:
                            print(f"[search_similar] No vectors found for {req.image_id}")
            except asyncio.TimeoutError:
                print(f"[search_similar] Vector retrieval timed out for {req.image_id}")
            except Exception as e:
                print(f"[search_similar] Failed to retrieve vector for {req.image_id}: {e}")

        effective_query_vector = query_vector
        effective_vector_name = vector_name
        if query_vector:
            effective_query_vector, effective_vector_name = apply_taste_profile_to_query(
                user.id,
                req.taste_profile_id,
                query_vector=list(query_vector),
                query_vector_type=vector_name,
                blend_weight=req.taste_profile_weight if req.taste_profile_weight is not None else 0.24,
            )

        if effective_query_vector:
            # KNN similarity search using the named vector
            count_result = client.count(
                collection_name=collection,
                count_filter=qdrant_filter,
                exact=True,
            )
            total = count_result.count
            query_response = client.query_points(
                collection_name=collection,
                query=effective_query_vector,
                using=effective_vector_name,
                query_filter=qdrant_filter,
                limit=req.page_size,
                offset=offset,
                with_payload=True,
            )
            results = query_response.points
            print(f"[search_similar] Vector search found {len(results)} results (total filtered: {total})")
        else:
            # Fallback to filtered scroll using the same page-based contract as vector search.
            count_result = client.count(
                collection_name=collection,
                count_filter=qdrant_filter,
                exact=True,
            )
            total = count_result.count
            results = _scroll_filtered_page(
                client=client,
                collection_name=collection,
                scroll_filter=qdrant_filter,
                offset=offset,
                limit=req.page_size,
                with_payload=True,
            )
            print(f"[search_similar] Scroll fallback found {len(results)} results (total: {total})")

        formatted = []
        for point in results:
            item = _format_result(point.payload, getattr(point, "score", 0) or 0)
            item.pop("garments_raw", None)
            item.pop("extracted_colors_raw", None)
            formatted.append(item)

        return {
            "images": _annotate_catalog_images_for_user(user.id, formatted),
            "total": total,
            "page": req.page,
            "page_size": req.page_size,
            "has_more": offset + req.page_size < total,
        }
    except Exception as e:
        print(f"[search_similar] Unexpected error: {e}")
        import traceback
        traceback.print_exc()
        return {
            "images": [],
            "total": 0,
            "page": req.page,
            "page_size": req.page_size,
            "has_more": False,
        }


@router.post("/search_by_color")
async def search_by_color_endpoint(
    req: SearchByColorRequest,
    user: Annotated[AuthenticatedUser, Depends(get_current_user)],
):
    """Search images by color similarity, sorted by percentage (highest first).

    Uses in-memory color index with vectorized NumPy Delta-E for <20ms queries.
    """
    from ..agent.color_index import get_color_index
    from ..agent.qdrant_utils import format_result as _format_result

    color_index = get_color_index()
    result = color_index.search(
        target_hex=req.hex.strip(),
        threshold=req.threshold,
        min_percentage=req.min_percentage,
        gender=req.gender,
        quarter=normalize_quarter_value(req.quarter),
        page=req.page,
        page_size=req.page_size,
    )

    formatted = []
    for _pct, _dist, payload in result["results"]:
        item = _format_result(payload, 0)
        item.pop("garments_raw", None)
        item.pop("extracted_colors_raw", None)
        formatted.append(item)

    return {
        "images": _annotate_catalog_images_for_user(user.id, formatted),
        "total": result["total"],
        "page": req.page,
        "page_size": req.page_size,
        "has_more": result["has_more"],
    }


# ── Session management endpoints ──

@router.get("/sessions")
async def get_sessions(
    user: Annotated[AuthenticatedUser, Depends(get_current_user)],
):
    """Get all chat sessions for the authenticated user."""
    sessions = list_sessions(user.id)
    return {"success": True, "data": sessions}


@router.get("/preferences/options")
async def list_chat_preference_options_endpoint(
    user: Annotated[AuthenticatedUser, Depends(get_current_user)],
):
    """Expose live retrieval preference options derived from the current Qdrant catalog."""
    _ = user
    return {"success": True, "data": _serialize_chat_preference_options()}


@router.post("/sessions")
async def create_session_endpoint(
    req: CreateSessionRequest,
    user: Annotated[AuthenticatedUser, Depends(get_current_user)],
):
    """Create a new chat session."""
    session = create_session(
        user.id,
        req.title,
        preferences=req.preferences.model_dump() if req.preferences else None,
    )
    return {"success": True, "data": session}


@router.patch("/sessions/{session_id}")
async def update_session_endpoint(
    session_id: str,
    req: UpdateSessionRequest,
    user: Annotated[AuthenticatedUser, Depends(get_current_user)],
):
    """Update a session's title or pinned state."""
    updated = update_session_preferences(
        session_id,
        user.id,
        title=req.title,
        pinned=req.pinned,
        preferences=req.preferences.model_dump(exclude_unset=True) if req.preferences else None,
    )
    if not updated:
        return JSONResponse(
            status_code=404,
            content={"success": False, "error": "会话不存在"},
        )
    return {"success": True, "data": updated}


@router.delete("/sessions/{session_id}")
async def delete_session_endpoint(
    session_id: str,
    user: Annotated[AuthenticatedUser, Depends(get_current_user)],
):
    """Delete a chat session."""
    deleted = delete_session(session_id, user.id)
    if not deleted:
        return JSONResponse(
            status_code=404,
            content={"success": False, "error": "会话不存在"},
        )
    return {"success": True}


@router.get("/sessions/{session_id}/messages")
async def get_session_messages(
    session_id: str,
    user: Annotated[AuthenticatedUser, Depends(get_current_user)],
    limit: int = 100,
    offset: int = 0,
    include_system: bool = True,
):
    """List messages in a chat session."""
    messages = list_messages(
        session_id=session_id,
        user_id=user.id,
        limit=limit,
        offset=offset,
        include_system=include_system,
    )
    return {"success": True, "data": messages}


# ── WebSocket endpoint ─────────────────────────────────────────────────────────

@router.websocket("/ws/chat")
async def websocket_chat(websocket: WebSocket):
    """WebSocket chat endpoint with JWT authentication via query param.

    Falls back to SSE POST /api/chat if WebSocket is unavailable.

    Query params:
      token: JWT access token (required)
      session_id: chat session UUID (required)

    Message format (client -> server):
      {"type": "chat", "message": "...", "history": []}
      {"type": "ping"}

    Message format (server -> client):
      {"type": "text", "content": "..."}
      {"type": "tool_result", "step": 1, ...}
      {"type": "done"}
      {"type": "error", "message": "..."}
      {"type": "pong"}
    """
    token = websocket.query_params.get("token")
    session_id = websocket.query_params.get("session_id")

    if not token or not session_id:
        await websocket.close(code=4001, reason="Missing token or session_id")
        return

    try:
        user = verify_access_token(token)
    except ValueError:
        await websocket.close(code=4001, reason="Invalid or expired token")
        return

    if user.session_id is not None and not is_session_valid(user.session_id, user.id):
        await websocket.close(code=4001, reason="Session revoked")
        return

    session = await asyncio.to_thread(get_session, session_id)
    if not session or session.get("user_id") != user.id:
        await websocket.close(code=4004, reason="Session not found")
        return

    await websocket.accept()

    # Register connection
    await ws_manager.connect(
        user.id,
        websocket,
        session_id,
        auth_session_id=user.session_id,
    )
    thread_id = get_thread_id(user.id, session_id, 1)
    await asyncio.to_thread(touch_session, session_id)

    # Route incoming Redis broadcast messages to this websocket
    async def on_broadcast(data: dict):
        if data.get("event") == "presence":
            return
        if (
            data.get("event") == "session_revoked"
            and user.session_id is not None
            and user.session_id in set(data.get("session_ids", []))
        ):
            try:
                await websocket.close(code=4001, reason="Session revoked")
            except Exception:
                pass
            return
        try:
            await websocket.send_json(data)
        except Exception:
            pass

    sub_task = asyncio.create_task(_route_broadcast(websocket, user.id, on_broadcast))

    try:
        agent = await get_agent()

        async for raw in websocket.iter_text():
            if user.session_id is not None and not is_session_valid(user.session_id, user.id):
                await websocket.close(code=4001, reason="Session revoked")
                break
            try:
                msg = json.loads(raw) if isinstance(raw, str) else {}
            except json.JSONDecodeError:
                await websocket.send_json({"type": "error", "message": "Invalid JSON"})
                continue

            msg_type = msg.get("type", "")

            if msg_type == "ping":
                await websocket.send_json({"type": "pong"})
                continue

            if msg_type == "chat":
                raw_content = msg.get("content")
                if not isinstance(raw_content, list):
                    await websocket.send_json({"type": "error", "message": "消息内容格式无效"})
                    continue

                content_blocks = _normalize_message_content(raw_content)
                if not content_blocks:
                    await websocket.send_json({"type": "error", "message": "消息内容不能为空"})
                    continue

                await asyncio.to_thread(maybe_compact_session, session_id, user.id)
                session = await asyncio.to_thread(get_session, session_id)
                if not session or session.get("user_id") != user.id:
                    await websocket.send_json({"type": "error", "message": "会话不存在"})
                    continue
                thread_id = get_thread_id(user.id, session_id, int(session.get("thread_version", 1) or 1))
                compaction_bootstrap = await asyncio.to_thread(
                    get_compaction_bootstrap_payload,
                    session_id,
                    user.id,
                    thread_version=int(session.get("thread_version", 1) or 1),
                )

                content_blocks = await asyncio.to_thread(
                    _persist_inline_media_blocks,
                    session_id,
                    content_blocks,
                )

                raw_content_blocks = _normalize_message_content(raw_content)
                restored_agent_session = await asyncio.to_thread(
                    _restore_agent_session_from_runtime_state,
                    session_id=session_id,
                    thread_id=thread_id,
                )
                if not restored_agent_session:
                    restored_agent_session = await _restore_agent_session_from_history(
                        thread_id,
                        msg.get("history", []),
                        thread_version=int(session.get("thread_version", 1) or 1),
                    )
                image_blocks = _extract_image_blocks(raw_content_blocks)
                query_text = _extract_text_from_blocks(raw_content_blocks)
                current_query_context = await _build_query_context(raw_content_blocks)
                if current_query_context and image_blocks:
                    remember_session_images(
                        thread_id,
                        image_blocks=image_blocks,
                        context=current_query_context,
                    )
                existing_agent_session = restored_agent_session or get_agent_session({"configurable": {"thread_id": thread_id}})
                session_semantics = get_session_semantics(thread_id)
                runtime_state_snapshot = await asyncio.to_thread(get_session_agent_runtime, session_id)
                execution_state_snapshot = (
                    runtime_state_snapshot.get("execution_state", {})
                    if isinstance(runtime_state_snapshot, dict) and isinstance(runtime_state_snapshot.get("execution_state"), dict)
                    else {}
                )
                fallback_image_blocks = [] if image_blocks else get_session_image_blocks(thread_id)
                turn_context = build_turn_context(
                    query_text=query_text,
                    has_images=bool(image_blocks or fallback_image_blocks),
                    session_filters=existing_agent_session.get("filters", []),
                    session_active=bool(existing_agent_session.get("active")),
                    session_primary_category=session_semantics.get("primary_category"),
                )
                set_turn_context(thread_id, turn_context)
                runtime_plan = build_runtime_plan(
                    query_text=query_text,
                    has_images=bool(image_blocks or fallback_image_blocks),
                    session_filters=existing_agent_session.get("filters", []),
                    session_active=bool(existing_agent_session.get("active")),
                    session_primary_category=session_semantics.get("primary_category"),
                    session_preferences=session.get("preferences") if isinstance(session, dict) else None,
                    session_semantics=session_semantics,
                    previous_plan=get_runtime_plan(thread_id),
                )
                set_runtime_plan(thread_id, runtime_plan)
                intent_brief = build_intent_brief(
                    query_text=query_text,
                    has_images=bool(image_blocks or fallback_image_blocks),
                    session_active=bool(existing_agent_session.get("active")),
                    turn_context=turn_context,
                    runtime_plan=runtime_plan,
                    session_semantics=session_semantics,
                )
                planner_frame = build_planner_frame(
                    runtime_plan=runtime_plan,
                    intent_brief=intent_brief,
                    execution_state=execution_state_snapshot,
                )
                agent_input = _compose_agent_input(
                    raw_content_blocks,
                    fallback_image_count=len(fallback_image_blocks),
                    turn_playbook=build_turn_playbook(turn_context),
                    intent_brief=format_intent_brief(intent_brief),
                    execution_state=format_execution_state(execution_state_snapshot),
                    planner_frame=format_planner_frame(planner_frame),
                    runtime_plan=format_runtime_plan(runtime_plan),
                    compaction_bootstrap=_format_compaction_bootstrap(compaction_bootstrap),
                    session_preferences=_format_session_preferences(session.get("preferences") if isinstance(session, dict) else None),
                )
                query_context = merge_query_contexts(
                    get_session_query_context(thread_id),
                    current_query_context,
                )
                set_query_context(thread_id, query_context)
                run_id = str(uuid.uuid4())
                history = msg.get("history", [])
                await asyncio.to_thread(auto_title_session, session_id, raw_content_blocks)
                await asyncio.to_thread(
                    set_session_execution_status,
                    session_id,
                    execution_status="running",
                    run_id=run_id,
                )

                await asyncio.to_thread(
                    create_message,
                    session_id,
                    "user",
                    content_blocks,
                    metadata={"thread_version": int(session.get("thread_version", 1) or 1)},
                )

                stream_result = StreamResult()
                assistant_message_id: str | None = None
                last_persisted_snapshot = ""
                last_persist_at = 0.0

                async def _sync_assistant_progress(*, force: bool = False, stream_state: str = "streaming") -> None:
                    nonlocal assistant_message_id, last_persisted_snapshot, last_persist_at

                    blocks = _materialize_stream_blocks(stream_result)
                    if not blocks and not assistant_message_id and stream_state == "streaming":
                        return

                    snapshot = json.dumps(blocks, ensure_ascii=False)
                    now = time.monotonic()
                    if (
                        not force
                        and stream_state == "streaming"
                        and snapshot == last_persisted_snapshot
                        and (now - last_persist_at) < 0.35
                    ):
                        return

                    assistant_message_id, _ = await _persist_streaming_assistant_message(
                        session_id=session_id,
                        message_id=assistant_message_id,
                        stream_result=stream_result,
                        stream_state=stream_state,
                        run_id=run_id,
                        thread_version=int(session.get("thread_version", 1) or 1),
                    )
                    last_persisted_snapshot = snapshot
                    last_persist_at = now

                try:
                    async for event in stream_agent_response(
                        agent=agent,
                        message=agent_input,
                        history=history,
                        thread_id=thread_id,
                        run_id=run_id,
                        result=stream_result,
                    ):
                        await websocket.send_text(event)
                        await _sync_assistant_progress()

                    if stream_result.content_blocks:
                        await _sync_assistant_progress(force=True, stream_state="completed")
                    await asyncio.to_thread(
                        set_session_execution_status,
                        session_id,
                        execution_status="completed",
                        run_id=run_id,
                    )
                    await asyncio.to_thread(
                        clear_compaction_bootstrap,
                        session_id,
                        thread_version=int(session.get("thread_version", 1) or 1),
                    )
                    _launch_post_run_title_finalize(
                        session_id=session_id,
                        raw_content_blocks=raw_content_blocks,
                        assistant_blocks=list(stream_result.content_blocks),
                    )
                except (WebSocketDisconnect, asyncio.CancelledError, ChatRunCancelledError):
                    await _sync_assistant_progress(force=True, stream_state="interrupted")
                    await asyncio.to_thread(
                        set_session_execution_status,
                        session_id,
                        execution_status=_resolve_interrupted_execution_status(stream_result),
                        run_id=run_id,
                    )
                    await asyncio.to_thread(
                        clear_compaction_bootstrap,
                        session_id,
                        thread_version=int(session.get("thread_version", 1) or 1),
                    )
                    _launch_post_run_title_finalize(
                        session_id=session_id,
                        raw_content_blocks=raw_content_blocks,
                        assistant_blocks=list(stream_result.content_blocks),
                    )
                    raise
                except Exception:
                    await _sync_assistant_progress(force=True, stream_state="error")
                    await asyncio.to_thread(
                        clear_compaction_bootstrap,
                        session_id,
                        thread_version=int(session.get("thread_version", 1) or 1),
                    )
                    raise
                finally:
                    set_query_context(thread_id, None)
                    clear_turn_context(thread_id)

    except WebSocketDisconnect:
        pass
    except Exception as e:
        await asyncio.to_thread(
            set_session_execution_status,
            session_id,
            execution_status="error",
            error_message=str(e),
        )
        try:
            await websocket.send_json({"type": "error", "message": str(e)})
        except Exception:
            pass
    finally:
        set_query_context(thread_id, None)
        clear_turn_context(thread_id)
        sub_task.cancel()
        await ws_manager.disconnect(user.id, websocket, session_id)


async def _route_broadcast(
    websocket: WebSocket,
    user_id: int,
    callback,
):
    """Subscribe to Redis broadcast and forward to websocket."""
    try:
        await ws_manager.subscribe_broadcast(callback)
    except asyncio.CancelledError:
        pass
    except Exception:
        pass
