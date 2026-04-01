from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import json

import pytest

from app.agent import query_context, session_state, tools
from app.routers import chat


@pytest.fixture(autouse=True)
def clear_in_memory_state():
    query_context._contexts.clear()
    query_context._session_image_contexts.clear()
    query_context._session_image_blocks.clear()
    session_state._sessions.clear()
    yield
    query_context._contexts.clear()
    query_context._session_image_contexts.clear()
    query_context._session_image_blocks.clear()
    session_state._sessions.clear()


def test_followup_text_turn_reuses_previous_image_context(monkeypatch):
    thread_id = "user-1:session-1"
    config = {"configurable": {"thread_id": thread_id}}

    query_context.remember_session_images(
        thread_id,
        image_blocks=[
            {
                "type": "image",
                "file_name": "look.jpg",
                "source": {"type": "url", "url": "https://example.com/look.jpg"},
            }
        ],
        context={"image_embeddings": [[1.0, 0.0, 0.0]], "image_count": 1},
    )
    query_context.set_query_context(thread_id, query_context.get_session_image_context(thread_id))

    monkeypatch.setattr(tools, "get_qdrant", lambda: object())
    monkeypatch.setattr(tools, "encode_text", lambda text: [0.0, 1.0, 0.0])
    monkeypatch.setattr(tools, "apply_aesthetic_boost", lambda vector: vector)
    monkeypatch.setattr(tools, "count_session", lambda client, session: 7)

    result = json.loads(tools.start_collection.func("red dress", config=config))
    session = session_state.get_session(config)

    assert result["status"] == "collection_started"
    assert result["total"] == 7
    assert "1 uploaded image" in result["message"]
    assert session["query"] == "red dress"
    assert session["q_emb"] == pytest.approx([0.919145, 0.393919, 0.0], rel=1e-6)


def test_followup_text_turn_gets_recent_image_hint():
    thread_id = "user-2:session-2"
    query_context.remember_session_images(
        thread_id,
        image_blocks=[
            {
                "type": "image",
                "file_name": "reference.png",
                "source": {"type": "url", "url": "https://example.com/reference.png"},
            }
        ],
        context={"image_embeddings": [[0.0, 0.0, 1.0]], "image_count": 1},
    )

    followup_blocks = [{"type": "text", "text": "继续找更正式一点的"}]
    agent_input = chat._compose_agent_input(
        followup_blocks,
        fallback_image_count=len(query_context.get_session_image_blocks(thread_id)),
    )

    assert "最近一次上传的 1 张图片仍可用于当前这轮检索" in agent_input
    assert "start_collection(query=用户补充条件或空字符串)" in agent_input
    assert "继续找更正式一点的" in agent_input
