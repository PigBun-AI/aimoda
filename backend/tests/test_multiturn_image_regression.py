from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import json

import pytest

from app.agent import query_context, session_state, tools
from app.agent import harness
from app.routers import chat


@pytest.fixture(autouse=True)
def clear_in_memory_state():
    harness._turn_contexts.clear()
    harness._session_semantics.clear()
    query_context._contexts.clear()
    query_context._session_image_contexts.clear()
    query_context._session_image_blocks.clear()
    query_context._session_style_contexts.clear()
    session_state._sessions.clear()
    yield
    harness._turn_contexts.clear()
    harness._session_semantics.clear()
    query_context._contexts.clear()
    query_context._session_image_contexts.clear()
    query_context._session_image_blocks.clear()
    query_context._session_style_contexts.clear()
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


def test_image_turn_playbook_prefers_semantic_query_before_category_bound_filters():
    turn_context = harness.build_turn_context(
        query_text="按这张图的感觉，更偏静奢一点",
        has_images=True,
    )

    playbook = harness.build_turn_playbook(turn_context)

    assert "category_bound_filters_without_single_category=forbidden" in playbook
    assert "unresolved_image_category_prefers_semantic_query=true" in playbook


def test_start_collection_fuses_style_query_with_text(monkeypatch):
    thread_id = "user-3:session-3"
    config = {"configurable": {"thread_id": thread_id}}

    query_context.remember_session_style(
        thread_id,
        style_retrieval_query="understated elegance, palette: camel, fabric: wool",
        style_name="quiet luxury",
    )
    query_context.set_query_context(thread_id, query_context.get_session_query_context(thread_id))

    monkeypatch.setattr(tools, "get_qdrant", lambda: object())

    def fake_encode_text(text: str):
        if "understated elegance" in text:
            return [1.0, 0.0, 0.0]
        if text == "dress":
            return [0.0, 1.0, 0.0]
        return [0.0, 0.0, 1.0]

    monkeypatch.setattr(tools, "encode_text", fake_encode_text)
    monkeypatch.setattr(tools, "apply_aesthetic_boost", lambda vector: vector)
    monkeypatch.setattr(tools, "count_session", lambda client, session: 11)

    result = json.loads(tools.start_collection.func("dress", config=config))
    session = session_state.get_session(config)

    assert result["status"] == "collection_started"
    assert result["style_retrieval_query"] == "understated elegance, palette: camel, fabric: wool"
    assert "style knowledge grounding" in result["message"]
    assert session["query"] == "dress"
    assert session["q_emb"] == pytest.approx([0.880471, 0.4741, 0.0], rel=1e-6)
