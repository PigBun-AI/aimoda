"""
Dev-only Router — Auth-free endpoints for rapid Agent iteration.

⚠️  These endpoints bypass JWT authentication entirely.
    They are ONLY mounted when ENV != "production".

Endpoints:
  GET  /api/dev/agent          — Serve the test HTML page
  POST /api/dev/chat           — SSE streaming chat (no auth)
  POST /api/dev/search_session — Direct search for Drawer pagination (no auth)
"""

import asyncio
from pathlib import Path
from typing import AsyncGenerator

from fastapi import APIRouter
from fastapi.responses import HTMLResponse, StreamingResponse, JSONResponse
from pydantic import BaseModel

from ..agent.graph import get_agent
from ..agent.sse import stream_agent_response, StreamResult, sse_event
from ..agent.tools import get_qdrant, _apply_session_filters, _format_result, _get_collection

router = APIRouter(prefix="/dev", tags=["dev"])

DEV_THREAD_ID = "dev:test-agent"


# ── Request models ──

class DevChatRequest(BaseModel):
    message: str
    history: list[dict] = []


class DevSearchSessionRequest(BaseModel):
    query: str = ""
    vector_type: str = "tag"
    q_emb: list[float] | None = None
    filters: list[dict] = []
    active: bool = True
    offset: int = 0
    limit: int = 20


# ── Serve test HTML ──

@router.get("/agent", response_class=HTMLResponse)
async def serve_agent_test_page():
    """Serve the Agent test HTML page."""
    html_path = Path(__file__).resolve().parent.parent.parent.parent / "temp" / "agent" / "index.html"
    if not html_path.exists():
        return HTMLResponse("<h1>Test page not found</h1><p>Expected at: temp/agent/index.html</p>", status_code=404)
    return HTMLResponse(html_path.read_text(encoding="utf-8"))


# ── Chat (no auth) ──

@router.post("/chat")
async def dev_chat_endpoint(req: DevChatRequest):
    """SSE streaming chat — bypasses JWT auth, uses fixed dev thread."""
    agent = await get_agent()
    stream_result = StreamResult()

    async def _generate() -> AsyncGenerator[str, None]:
        try:
            async for chunk in stream_agent_response(
                agent=agent,
                message=req.message,
                history=req.history,
                thread_id=DEV_THREAD_ID,
                result=stream_result,
            ):
                yield chunk
        except Exception:
            import traceback
            traceback.print_exc()
            yield sse_event({"type": "error", "message": "Agent stream failed."})

    return StreamingResponse(
        _generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


# ── Search session (no auth) ──

@router.post("/search_session")
async def dev_search_session_endpoint(req: DevSearchSessionRequest):
    """Search using session state directly — bypasses JWT auth."""
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
