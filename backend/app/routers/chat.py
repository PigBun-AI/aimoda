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
import json
from typing import Annotated, AsyncGenerator

from fastapi import APIRouter, Depends, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import StreamingResponse, JSONResponse
from pydantic import BaseModel

from ..dependencies import get_current_user
from ..models import AuthenticatedUser
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
    auto_title_session,
    set_session_execution_status,
)
from ..services.websocket_manager import ws_manager
from ..services.auth_token import verify_access_token
from ..agent.graph import get_agent
from ..agent.sse import stream_agent_response, StreamResult, sse_event
from ..agent.tools import get_qdrant, _apply_session_filters, _format_result, _get_collection

router = APIRouter(prefix="/chat", tags=["chat"])


# ── Request/Response models ──

class ChatRequest(BaseModel):
    message: str
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
    query: str = ""
    vector_type: str = "tag"
    q_emb: list[float] | None = None
    filters: list[dict] = []
    active: bool = True
    offset: int = 0
    limit: int = 20


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

    thread_id = get_thread_id(user.id, req.session_id)

    # Touch session + auto-title (run sync DB ops in thread pool)
    await asyncio.to_thread(touch_session, req.session_id)
    await asyncio.to_thread(auto_title_session, req.session_id, req.message)
    await asyncio.to_thread(
        set_session_execution_status,
        req.session_id,
        execution_status="running",
    )

    # Persist user message (wraps text in ContentBlock format)
    user_content = [{"type": "text", "text": req.message}]
    await asyncio.to_thread(
        create_message, req.session_id, "user", user_content
    )

    # Create StreamResult to collect full assistant text
    stream_result = StreamResult()

    async def _generate() -> AsyncGenerator[str, None]:
        """Wrap the agent stream, then persist the assistant message."""
        try:
            async for chunk in stream_agent_response(
                agent=agent,
                message=req.message,
                history=req.history,
                thread_id=thread_id,
                result=stream_result,
            ):
                yield chunk

            # After streaming completes, persist assistant message using ContentBlocks
            if stream_result.content_blocks:
                await asyncio.to_thread(
                    create_message, req.session_id, "assistant",
                    stream_result.content_blocks,
                    metadata={"stop_reason": stream_result.stop_reason},
                )
            await asyncio.to_thread(
                set_session_execution_status,
                req.session_id,
                execution_status="completed",
            )
        except Exception:
            import traceback
            traceback.print_exc()
            await asyncio.to_thread(
                set_session_execution_status,
                req.session_id,
                execution_status="error",
                error_message="Agent stream failed. Check server logs.",
            )
            yield sse_event({"type": "error", "message": "Agent stream failed. Check server logs."})

    return StreamingResponse(
        _generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/search_session")
async def search_session_endpoint(
    req: SearchSessionRequest,
    user: Annotated[AuthenticatedUser, Depends(get_current_user)],
):
    """Search using the session state directly for Drawer pagination."""
    client = get_qdrant()
    session = req.model_dump()

    results = _apply_session_filters(client, session)

    page = results[req.offset: req.offset + req.limit]

    formatted_page = []
    for p in page:
        item = _format_result(p.payload, getattr(p, 'score', 0))
        item.pop("garments_raw", None)
        item.pop("extracted_colors_raw", None)
        formatted_page.append(item)

    return {
        "images": formatted_page,
        "total": len(results),
        "offset": req.offset,
        "limit": req.limit,
        "has_more": req.offset + req.limit < len(results),
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

    session = await asyncio.to_thread(get_session, session_id)
    if not session or session.get("user_id") != user.id:
        await websocket.close(code=4004, reason="Session not found")
        return

    await websocket.accept()

    # Register connection
    await ws_manager.connect(user.id, websocket, session_id)
    thread_id = get_thread_id(user.id, session_id)
    await asyncio.to_thread(touch_session, session_id)

    # Route incoming Redis broadcast messages to this websocket
    async def on_broadcast(data: dict):
        if data.get("event") == "presence":
            return
        try:
            await websocket.send_json(data)
        except Exception:
            pass

    sub_task = asyncio.create_task(_route_broadcast(websocket, user.id, on_broadcast))

    try:
        agent = await get_agent()

        async for raw in websocket.iter_text():
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
                message_text = msg.get("message", "")
                history = msg.get("history", [])
                await asyncio.to_thread(auto_title_session, session_id, message_text)
                await asyncio.to_thread(
                    set_session_execution_status,
                    session_id,
                    execution_status="running",
                )

                # Persist user message (wraps text in ContentBlock format)
                user_content = [{"type": "text", "text": message_text}]
                await asyncio.to_thread(
                    create_message, session_id, "user", user_content
                )

                stream_result = StreamResult()

                async for event in stream_agent_response(
                    agent=agent,
                    message=message_text,
                    history=history,
                    thread_id=thread_id,
                    result=stream_result,
                ):
                    await websocket.send_text(event)

                # Persist assistant message using ContentBlocks
                if stream_result.content_blocks:
                    await asyncio.to_thread(
                        create_message, session_id, "assistant",
                        stream_result.content_blocks,
                        metadata={"stop_reason": stream_result.stop_reason},
                    )
                await asyncio.to_thread(
                    set_session_execution_status,
                    session_id,
                    execution_status="completed",
                )

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
