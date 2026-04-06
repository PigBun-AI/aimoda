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
import time
import uuid
from typing import Annotated, Any, AsyncGenerator

from fastapi import APIRouter, Depends, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import StreamingResponse, JSONResponse
from pydantic import BaseModel

from ..dependencies import get_current_user
from ..models import AuthenticatedUser
from ..services.feature_access_service import consume_feature_access, get_feature_access_status
from ..services.chat_service import (
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
    maybe_compact_session,
    get_compaction_bootstrap_payload,
    clear_compaction_bootstrap,
)
from ..services.oss_service import get_oss_service
from ..services.websocket_manager import ws_manager
from ..services.chat_run_registry import chat_run_registry
from ..services.auth_token import verify_access_token
from ..repositories.session_repo import is_session_valid
from ..agent.graph import get_agent
from ..agent.sse import stream_agent_response, StreamResult, sse_event
from ..agent.qdrant_utils import get_qdrant, format_result, get_collection, encode_image
from ..agent.session_state import (
    count_session,
    get_session_page,
    get_session as get_agent_session,
    set_session as set_agent_session,
)
from ..agent.harness import (
    build_turn_context,
    build_turn_playbook,
    get_session_semantics,
    set_session_semantics,
    update_session_semantics,
    set_turn_context,
    clear_turn_context,
)
from ..agent.query_context import (
    set_query_context,
    remember_session_images,
    remember_session_style,
    get_session_image_blocks,
    get_session_query_context,
    merge_query_contexts,
)

router = APIRouter(prefix="/chat", tags=["chat"])


# ── Request/Response models ──

class ChatRequest(BaseModel):
    content: list[dict[str, Any]]
    session_id: str
    history: list[dict] = []


class CreateSessionRequest(BaseModel):
    title: str = "新对话"


class UpdateSessionRequest(BaseModel):
    title: str | None = None
    pinned: bool | None = None


class ListMessagesRequest(BaseModel):
    limit: int = 100
    offset: int = 0
    include_system: bool = True


class SearchSessionRequest(BaseModel):
    """Direct search API using the Agent's internal session state."""
    search_request_id: str
    offset: int = 0
    limit: int = 20


class StopSessionRunRequest(BaseModel):
    run_id: str | None = None


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


async def _persist_streaming_assistant_message(
    *,
    session_id: str,
    message_id: str | None,
    stream_result: StreamResult,
    stream_state: str,
    run_id: str | None = None,
) -> str | None:
    blocks = _materialize_stream_blocks(stream_result)
    if not blocks and not message_id:
        return None

    metadata_patch: dict[str, Any] = {"stream_state": stream_state}
    if stream_result.stop_reason:
        metadata_patch["stop_reason"] = stream_result.stop_reason
    if run_id:
        metadata_patch["run_id"] = run_id

    if message_id:
        await asyncio.to_thread(
            update_message,
            message_id,
            content=blocks,
            metadata_patch=metadata_patch,
        )
        return message_id

    if not blocks:
        return None

    created = await asyncio.to_thread(
        create_message,
        session_id,
        "assistant",
        blocks,
        metadata=metadata_patch,
    )
    return str(created["id"])


def _resolve_interrupted_execution_status(stream_result: StreamResult) -> str:
    return "completed" if _materialize_stream_blocks(stream_result) else "idle"


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
) -> dict[str, Any] | None:
    """Hydrate agent session state from the latest persisted show_collection result.

    This keeps multi-turn retrieval stable even if the next request lands on a
    different worker process, where in-memory agent session state would be empty.
    """
    if not history:
        return None

    for message in reversed(history):
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
    compaction_bootstrap: str = "",
) -> str:
    image_count = len(_extract_image_blocks(blocks))
    text = _extract_text_from_blocks(blocks)
    prefix_parts = []
    if turn_playbook:
        prefix_parts.append(turn_playbook)
    if compaction_bootstrap:
        prefix_parts.append(compaction_bootstrap)
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
        restored_agent_session = await _restore_agent_session_from_history(thread_id, req.history)

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
    fallback_image_blocks = [] if image_blocks else get_session_image_blocks(thread_id)
    turn_context = build_turn_context(
        query_text=query_text,
        has_images=bool(image_blocks or fallback_image_blocks),
        session_filters=existing_agent_session.get("filters", []),
        session_active=bool(existing_agent_session.get("active")),
        session_primary_category=session_semantics.get("primary_category"),
    )
    set_turn_context(thread_id, turn_context)
    agent_input = _compose_agent_input(
        raw_content_blocks,
        fallback_image_count=len(fallback_image_blocks),
        turn_playbook=build_turn_playbook(turn_context),
        compaction_bootstrap=_format_compaction_bootstrap(compaction_bootstrap),
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
        create_message, req.session_id, "user", content_blocks
    )

    # Create StreamResult to collect full assistant text
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

        assistant_message_id = await _persist_streaming_assistant_message(
            session_id=req.session_id,
            message_id=assistant_message_id,
            stream_result=stream_result,
            stream_state=stream_state,
            run_id=run_id,
        )
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
                result=stream_result,
            ):
                _enqueue_stream_chunk(chunk)
                await _sync_assistant_progress()

            # After streaming completes, persist assistant message using ContentBlocks
            if stream_result.content_blocks:
                await _sync_assistant_progress(force=True, stream_state="completed")
                await asyncio.to_thread(
                    finalize_session_title,
                    req.session_id,
                    raw_content_blocks,
                    stream_result.content_blocks,
                )
            await asyncio.to_thread(
                clear_compaction_bootstrap,
                req.session_id,
                thread_version=int(session.get("thread_version", 1) or 1),
            )
            await asyncio.to_thread(
                set_session_execution_status,
                req.session_id,
                execution_status="completed",
                run_id=run_id,
            )
        except asyncio.CancelledError:
            await _sync_assistant_progress(force=True, stream_state="interrupted")
            if stream_result.content_blocks:
                await asyncio.to_thread(
                    finalize_session_title,
                    req.session_id,
                    raw_content_blocks,
                    stream_result.content_blocks,
                )
            await asyncio.to_thread(
                clear_compaction_bootstrap,
                req.session_id,
                thread_version=int(session.get("thread_version", 1) or 1),
            )
            await asyncio.to_thread(
                set_session_execution_status,
                req.session_id,
                execution_status=_resolve_interrupted_execution_status(stream_result),
                run_id=run_id,
            )
        except Exception:
            import traceback
            traceback.print_exc()
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
                error_message="Agent stream failed. Check server logs.",
            )
            _enqueue_stream_chunk(sse_event({"type": "error", "message": "Agent stream failed. Check server logs."}))
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

    return {
        "success": True,
        "data": {
            "session_id": session_id,
            "run_id": body.run_id,
            "stopped": stopped,
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
    page = get_session_page(client, session, offset=req.offset, limit=req.limit)

    formatted_page = []
    for p in page:
        item = format_result(p.payload, getattr(p, 'score', 0))
        item.pop("garments_raw", None)
        item.pop("extracted_colors_raw", None)
        formatted_page.append(item)

    return {
        "images": formatted_page,
        "total": total,
        "offset": req.offset,
        "limit": req.limit,
        "has_more": req.offset + req.limit < total,
    }


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
        return item
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to retrieve image: {e}")


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
    page: int = 1
    page_size: int = 56


class SearchByColorRequest(BaseModel):
    """Color similarity search by hex value."""
    hex: str
    color_name: str = ""
    threshold: float = 80.0
    min_percentage: float = 0.0
    gender: str | None = None
    quarter: str | None = None
    page: int = 1
    page_size: int = 56


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

        if query_vector:
            # KNN similarity search using the named vector
            query_response = client.query_points(
                collection_name=collection,
                query=query_vector,
                using=vector_name,
                query_filter=qdrant_filter,
                limit=req.page_size,
                offset=offset,
                with_payload=True,
            )
            results = query_response.points
            count_result = client.count(
                collection_name=collection,
                count_filter=qdrant_filter,
                exact=True,
            )
            total = count_result.count
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
        for p in results:
            item = _format_result(p.payload, getattr(p, 'score', 0))
            item.pop("garments_raw", None)
            item.pop("extracted_colors_raw", None)
            formatted.append(item)

        return {
            "images": formatted,
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
        quarter=req.quarter,
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
        "images": formatted,
        "total": result["total"],
        "page": result["page"],
        "page_size": result["page_size"],
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


@router.post("/sessions")
async def create_session_endpoint(
    req: CreateSessionRequest,
    user: Annotated[AuthenticatedUser, Depends(get_current_user)],
):
    """Create a new chat session."""
    session = create_session(user.id, req.title)
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
                fallback_image_blocks = [] if image_blocks else get_session_image_blocks(thread_id)
                turn_context = build_turn_context(
                    query_text=query_text,
                    has_images=bool(image_blocks or fallback_image_blocks),
                    session_filters=existing_agent_session.get("filters", []),
                    session_active=bool(existing_agent_session.get("active")),
                    session_primary_category=session_semantics.get("primary_category"),
                )
                set_turn_context(thread_id, turn_context)
                agent_input = _compose_agent_input(
                    raw_content_blocks,
                    fallback_image_count=len(fallback_image_blocks),
                    turn_playbook=build_turn_playbook(turn_context),
                    compaction_bootstrap=_format_compaction_bootstrap(compaction_bootstrap),
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
                    create_message, session_id, "user", content_blocks
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

                    assistant_message_id = await _persist_streaming_assistant_message(
                        session_id=session_id,
                        message_id=assistant_message_id,
                        stream_result=stream_result,
                        stream_state=stream_state,
                        run_id=run_id,
                    )
                    last_persisted_snapshot = snapshot
                    last_persist_at = now

                try:
                    async for event in stream_agent_response(
                        agent=agent,
                        message=agent_input,
                        history=history,
                        thread_id=thread_id,
                        result=stream_result,
                    ):
                        await websocket.send_text(event)
                        await _sync_assistant_progress()

                    if stream_result.content_blocks:
                        await _sync_assistant_progress(force=True, stream_state="completed")
                        await asyncio.to_thread(
                            finalize_session_title,
                            session_id,
                            raw_content_blocks,
                            stream_result.content_blocks,
                        )
                    await asyncio.to_thread(
                        clear_compaction_bootstrap,
                        session_id,
                        thread_version=int(session.get("thread_version", 1) or 1),
                    )
                    await asyncio.to_thread(
                        set_session_execution_status,
                        session_id,
                        execution_status="completed",
                        run_id=run_id,
                    )
                except (WebSocketDisconnect, asyncio.CancelledError):
                    await _sync_assistant_progress(force=True, stream_state="interrupted")
                    if stream_result.content_blocks:
                        await asyncio.to_thread(
                            finalize_session_title,
                            session_id,
                            raw_content_blocks,
                            stream_result.content_blocks,
                        )
                    await asyncio.to_thread(
                        clear_compaction_bootstrap,
                        session_id,
                        thread_version=int(session.get("thread_version", 1) or 1),
                    )
                    await asyncio.to_thread(
                        set_session_execution_status,
                        session_id,
                        execution_status=_resolve_interrupted_execution_status(stream_result),
                        run_id=run_id,
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
