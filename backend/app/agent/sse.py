"""
SSE streaming utilities for the fashion search agent.

Provides `stream_agent_response` which wraps a LangGraph agent and yields
SSE-formatted events that follow the ContentBlock model:

  - content_block_start  { type, index, block_type, ...block }
  - content_block_delta  { type, index, delta }
  - content_block_stop   { type, index }
  - message_stop         { type, stop_reason }

Each event is prefixed with "data: " and terminated with "\\n\\n",
compatible with the SSE spec and FastAPI StreamingResponse.
"""

from __future__ import annotations

import json
import re
import uuid
from typing import Any, AsyncGenerator


def extract_images_from_json(text: str) -> tuple[list[dict], dict]:
    """Extract image objects and metadata from JSON tool result."""
    meta: dict = {}
    try:
        data = json.loads(text)
        if isinstance(data, dict):
            remaining_val = data.get("remaining")
            if remaining_val is None:
                remaining_val = data.get("total", None)
            meta = {
                "match_level": data.get("match_level", ""),
                "note": data.get("note", ""),
                "total": data.get("total", 0),
                "remaining": remaining_val,
                "search_request_id": data.get("search_request_id"),
            }
            items = data.get("results", data.get("sample_images", []))
        elif isinstance(data, list):
            items = data
        else:
            return [], meta
        images = []
        for item in items:
            url = item.get("image_url", item.get("url", ""))
            if url and url.startswith("http"):
                images.append({
                    "image_url": url,
                    "image_id": item.get("image_id", ""),
                    "brand": item.get("brand", ""),
                    "year": item.get("year"),
                    "quarter": item.get("quarter") or item.get("season"),
                    "season": item.get("season"),
                    "score": item.get("score", 0),
                    "garments": item.get("garments", []),
                    "colors": item.get("colors", []),
                    "style": item.get("style", ""),
                    "object_area": item.get("object_area"),
                })
        return images, meta
    except (json.JSONDecodeError, AttributeError):
        pass
    return [], meta


def sse_event(data: dict) -> str:
    """Serialize a dict to an SSE-formatted string."""
    return f"data: {json.dumps(data, ensure_ascii=False)}\n\n"


class StreamResult:
    """Accumulates the full agent response across the SSE stream."""

    __slots__ = ("content_blocks", "full_text", "stop_reason")

    def __init__(self) -> None:
        self.content_blocks: list[dict] = []
        self.full_text: str = ""
        self.stop_reason: str = ""


def _ensure_result_block(result: StreamResult, index: int, block: dict) -> dict:
    """Store a block at its stream index, preserving final message order."""
    while len(result.content_blocks) <= index:
        result.content_blocks.append({})
    result.content_blocks[index] = block
    return block


def _build_text_block(index: int, partial: str = "") -> tuple[dict, int]:
    """Create a text ContentBlock and return (block, next_index)."""
    block = {"type": "text", "text": partial}
    return block, index


def _build_tool_use_block(
    call_id: str,
    tool_name: str,
    tool_args: dict,
    index: int,
) -> tuple[dict, int]:
    """Create a tool_use ContentBlock and return (block, next_index)."""
    block = {
        "type": "tool_use",
        "id": call_id,
        "name": tool_name,
        "input": tool_args,
    }
    return block, index


def _build_tool_result_block(
    tool_use_id: str,
    content: str,
    images: list,
    meta: dict,
    index: int,
) -> tuple[dict, int]:
    """Create a tool_result ContentBlock and return (block, next_index)."""
    block = {
        "type": "tool_result",
        "tool_use_id": tool_use_id,
        "content": content,
        "images": images,
        "metadata": meta,
    }
    return block, index


async def stream_agent_response(
    agent,
    message: str | list[dict[str, Any]],
    history: list,
    thread_id: str,
    result: StreamResult | None = None,
) -> AsyncGenerator[str, None]:
    """Stream agent response as ContentBlock SSE events.

    Yields SSE strings that the FastAPI StreamingResponse can forward directly.

    The optional `result` parameter is mutated in-place to carry the final
    content_blocks and full_text after the stream completes.
    """
    full_text_parts: list[str] = []
    seen_tool_call_ids: set[str] = set()
    closed_tool_call_ids: set[str] = set()
    current_block_index: int = -1  # will be incremented to 0 on first block
    text_block_index: int = -1     # -1 means no text block yet
    tool_call_index_map: dict[str, int] = {}

    # Track streaming tool calls to prevent on_tool_start from
    # re-emitting content_block_start for the same tool.
    # Maps tool_name -> streaming call_ids (from tool_call_chunks).
    # Use a FIFO queue so repeated tool names do not corrupt stop events.
    streaming_tool_name_to_ids: dict[str, list[str]] = {}
    # Maps run_id (from on_tool_start/end) -> streaming call_id
    run_id_to_call_id: dict[str, str] = {}

    # State tracking for block lifecycle
    active_tool_use_id: str = ""
    # Whether the current text block is "open" (started but not stopped)
    text_block_open: bool = False

    try:
        config = {
            "configurable": {"thread_id": thread_id},
            "recursion_limit": 100,
        }

        # LangGraph's checkpointer (AsyncPostgresSaver) already persists the
        # full conversation state keyed by thread_id. The system prompt is
        # injected by create_react_agent(prompt=SYSTEM_PROMPT) in graph.py.
        #
        # We ONLY send the new user message here. DO NOT:
        #  - re-send the system prompt (it's already in the graph)
        #  - replay history (it's already in the checkpoint)
        # Doing either causes "multiple non-consecutive system messages" errors
        # and duplicated messages on multi-turn conversations.
        from langchain_core.messages import HumanMessage
        user_message = HumanMessage(content=message)

        # ── Invoke agent ───────────────────────────────────────────────────────
        async for event in agent.astream_events(
            {"messages": [user_message]},
            config,
            version="v2",
        ):
            kind = event.get("event", "")
            tags = event.get("tags") or []

            # ── Text delta (streaming from model) ─────────────────────────────
            if kind == "on_chat_model_stream":
                chunk = event.get("data", {}).get("chunk", {})
                if not chunk:
                    continue

                # Text delta — emit as content_block_delta
                if hasattr(chunk, "content") and chunk.content:
                    text_content = chunk.content
                    # chunk.content can be a plain string or a list of blocks
                    if isinstance(text_content, str):
                        delta = text_content
                    elif isinstance(text_content, list):
                        # Extract text from block dicts
                        delta_parts = []
                        for block in text_content:
                            if isinstance(block, dict) and block.get("type") == "text":
                                delta_parts.append(block.get("text", ""))
                            elif isinstance(block, str):
                                delta_parts.append(block)
                        delta = "".join(delta_parts)
                    else:
                        delta = ""

                    if delta:
                        # Start a new text block if:
                        # 1. No text block exists yet (text_block_index == -1)
                        # 2. Previous text block was closed (after tool calls)
                        if not text_block_open:
                            current_block_index += 1
                            text_block_index = current_block_index
                            text_block, _ = _build_text_block(text_block_index)
                            if result is not None:
                                _ensure_result_block(result, text_block_index, text_block)
                            yield sse_event({
                                **text_block,
                                "type": "content_block_start",
                                "index": text_block_index,
                                "block_type": "text",
                            })
                            text_block_open = True
                        full_text_parts.append(delta)
                        yield sse_event({
                            "type": "content_block_delta",
                            "index": text_block_index,
                            "delta": delta,
                        })
                        if result is not None and text_block_index < len(result.content_blocks):
                            blk = result.content_blocks[text_block_index]
                            if blk.get("type") == "text":
                                blk["text"] = f'{blk.get("text", "")}{delta}'

                # Tool call chunks (streaming input) — emit as content_block_delta
                if hasattr(chunk, "tool_call_chunks") and chunk.tool_call_chunks:
                    for tc_chunk in chunk.tool_call_chunks:
                        tc_id = tc_chunk.get("id") or tc_chunk.get("index", "")
                        tc_name = tc_chunk.get("name", "")
                        tc_args = tc_chunk.get("args", {})

                        # First chunk with name → start tool_use block
                        if tc_name and tc_id and tc_id not in seen_tool_call_ids:
                            # Close open text block before starting tool block
                            if text_block_open:
                                yield sse_event({
                                    "type": "content_block_stop",
                                    "index": text_block_index,
                                })
                                text_block_open = False
                            seen_tool_call_ids.add(tc_id)
                            current_block_index += 1
                            block_index = current_block_index
                            active_tool_use_id = tc_id
                            tool_call_index_map[tc_id] = block_index
                            # Track by name so on_tool_start can find this streaming call
                            streaming_tool_name_to_ids.setdefault(tc_name, []).append(tc_id)

                            if isinstance(tc_args, str):
                                try:
                                    tc_args = json.loads(tc_args) if tc_args else {}
                                except json.JSONDecodeError:
                                    tc_args = {}
                            display_args = {
                                k: v for k, v in tc_args.items()
                                if k not in ("limit", "search_results_json")
                            } if isinstance(tc_args, dict) else {}

                            block, _ = _build_tool_use_block(
                                tc_id, tc_name, display_args, block_index
                            )
                            yield sse_event({
                                **block,
                                "type": "content_block_start",
                                "index": block_index,
                                "block_type": "tool_use",
                            })
                            if result is not None:
                                _ensure_result_block(
                                    result,
                                    block_index,
                                    {**block, "status": "running"},
                                )

                        # Subsequent chunks — emit delta with partial input
                        if tc_id in seen_tool_call_ids and tc_args:
                            if isinstance(tc_args, str):
                                try:
                                    tc_args = json.loads(tc_args) if tc_args else {}
                                except json.JSONDecodeError:
                                    tc_args = {}
                            display_args = {
                                k: v for k, v in tc_args.items()
                                if k not in ("limit", "search_results_json")
                            } if isinstance(tc_args, dict) else {}

                            yield sse_event({
                                "type": "content_block_delta",
                                "index": tool_call_index_map.get(tc_id, current_block_index),
                                "delta": display_args,
                            })

                            # Update stored block's input
                            if result is not None and result.content_blocks:
                                block_idx = tool_call_index_map.get(tc_id)
                                if block_idx is not None and block_idx < len(result.content_blocks):
                                    blk = result.content_blocks[block_idx]
                                    if blk.get("type") == "tool_use":
                                        blk["input"].update(display_args)

            # ── Tool call start (fallback: complete tool call, no streaming) ──
            elif kind == "on_tool_start":
                run_id = event.get("run_id", "")
                tool_name = event.get("name", "")
                tool_input = event.get("data", {}).get("input", {})
                call_id = str(run_id)[:36] if run_id else str(uuid.uuid4())

                # If this tool was already announced via streaming tool_call_chunks,
                # map run_id -> streaming call_id and skip re-emitting.
                streaming_ids = streaming_tool_name_to_ids.get(tool_name) or []
                if streaming_ids:
                    streaming_id = streaming_ids.pop(0)
                    if not streaming_ids:
                        streaming_tool_name_to_ids.pop(tool_name, None)
                    run_id_to_call_id[call_id] = streaming_id
                    # Close the streaming tool_use block if not already closed
                    if streaming_id not in closed_tool_call_ids:
                        block_idx = tool_call_index_map.get(streaming_id)
                        if block_idx is not None:
                            yield sse_event({
                                "type": "content_block_stop",
                                "index": block_idx,
                            })
                            closed_tool_call_ids.add(streaming_id)
                            if result is not None and block_idx < len(result.content_blocks):
                                blk = result.content_blocks[block_idx]
                                if blk.get("type") == "tool_use":
                                    blk["status"] = "done"
                    continue

                if call_id not in seen_tool_call_ids:
                    # Close open text block before starting tool block
                    if text_block_open:
                        yield sse_event({
                            "type": "content_block_stop",
                            "index": text_block_index,
                        })
                        text_block_open = False
                    seen_tool_call_ids.add(call_id)
                    current_block_index += 1
                    block_index = current_block_index
                    active_tool_use_id = call_id
                    tool_call_index_map[call_id] = block_index

                    display_args = {
                        k: v for k, v in (tool_input if isinstance(tool_input, dict) else {}).items()
                        if k not in ("limit", "search_results_json")
                    }

                    block, _ = _build_tool_use_block(
                        call_id, tool_name, display_args, block_index
                    )
                    yield sse_event({
                        **block,
                        "type": "content_block_start",
                        "index": block_index,
                        "block_type": "tool_use",
                    })
                    if result is not None:
                        _ensure_result_block(
                            result,
                            block_index,
                            {**block, "status": "running"},
                        )

                    # Stop the tool_use block (input is complete)
                    yield sse_event({
                        "type": "content_block_stop",
                        "index": block_index,
                    })
                    closed_tool_call_ids.add(call_id)
                    if result is not None and block_index < len(result.content_blocks):
                        blk = result.content_blocks[block_index]
                        if blk.get("type") == "tool_use":
                            blk["status"] = "done"

            # ── Tool result (after tool execution or error) ────────────────────
            elif kind in ("on_tool_end", "on_tool_error"):
                tool_name = event.get("name", "")
                run_id = event.get("run_id", "")
                raw_call_id = str(run_id)[:36] if run_id else active_tool_use_id
                # Resolve run_id -> streaming call_id if applicable
                call_id = run_id_to_call_id.get(raw_call_id, raw_call_id)

                if kind == "on_tool_end":
                    output = event.get("data", {}).get("output", "")
                    # Extract content from ToolMessage objects
                    # LangGraph returns ToolMessage with .content attribute, not a plain string
                    if hasattr(output, "content"):
                        content = output.content if isinstance(output.content, str) else str(output.content)
                    elif isinstance(output, str):
                        content = output
                    else:
                        content = str(output)
                else:
                    error_obj = event.get("data", {}).get("error", "Unknown error")
                    # Format standard error JSON to display gracefully on the UI 
                    content = json.dumps({"error": f"Tool execution failed: {error_obj}"}, ensure_ascii=False)

                # Close the corresponding tool_use block before sending tool_result.
                call_block_index = tool_call_index_map.get(call_id)
                if call_block_index is not None and call_id not in closed_tool_call_ids:
                    yield sse_event({
                        "type": "content_block_stop",
                        "index": call_block_index,
                    })
                    closed_tool_call_ids.add(call_id)
                    if result is not None and call_block_index < len(result.content_blocks):
                        blk = result.content_blocks[call_block_index]
                        if blk.get("type") == "tool_use":
                            blk["status"] = "done"

                current_block_index += 1
                block_index = current_block_index
                images, meta = extract_images_from_json(content)

                block, _ = _build_tool_result_block(
                    call_id, content, images, meta, block_index
                )

                # Start tool_result block
                yield sse_event({
                    **block,
                    "type": "content_block_start",
                    "index": block_index,
                    "block_type": "tool_result",
                })

                # Delta with the full result content
                yield sse_event({
                    "type": "content_block_delta",
                    "index": block_index,
                    "delta": content,
                })

                # Stop tool_result block
                yield sse_event({
                    "type": "content_block_stop",
                    "index": block_index,
                })

                if result is not None:
                    _ensure_result_block(result, block_index, block)

        # ── Finalize result ──────────────────────────────────────────────────
        full_text = "".join(full_text_parts)
        full_text = re.sub(
            r"""<think>.*?</think>\s*""",
            "",
            full_text,
            flags=re.DOTALL,
        ).strip()

        if text_block_open:
            yield sse_event({
                "type": "content_block_stop",
                "index": text_block_index,
            })
            text_block_open = False

        if result is not None:
            result.full_text = full_text
            result.content_blocks = [b for b in result.content_blocks if b]
            result.stop_reason = "end_turn"

        yield sse_event({"type": "message_stop", "stop_reason": "end_turn"})

    except Exception as e:
        import traceback
        traceback.print_exc()
        yield sse_event({"type": "error", "message": str(e)})
