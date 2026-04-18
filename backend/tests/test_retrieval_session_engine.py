import json

from backend.app.agent.tool_registry import ToolActor, ToolExecutionContext
from backend.app.services import retrieval_session_engine as engine_module
from backend.app.services.retrieval_session_engine import RetrievalSessionEngine


def test_start_collection_creates_retrieval_session(monkeypatch):
    monkeypatch.setattr(engine_module, "get_qdrant", lambda: object())
    monkeypatch.setattr(engine_module, "encode_text", lambda text, cancel_check=None: [0.2, 0.4])
    monkeypatch.setattr(engine_module, "apply_aesthetic_boost", lambda vector: vector)
    monkeypatch.setattr(engine_module, "count_session", lambda client, session, **kwargs: 42)
    monkeypatch.setattr(
        engine_module,
        "create_retrieval_session",
        lambda **kwargs: {
            "id": "retrieval-1",
            "actor_type": kwargs["actor_type"],
            "actor_id": kwargs["actor_id"],
            "user_id": kwargs["user_id"],
            "query": kwargs["query"],
            "vector_type": kwargs["vector_type"],
            "q_emb": kwargs["q_emb"],
            "active_filters": kwargs["active_filters"],
        },
    )
    monkeypatch.setattr(engine_module, "replace_retrieval_session_filters", lambda *args, **kwargs: None)

    ctx = ToolExecutionContext(
        actor=ToolActor(user_id=9),
        source="langgraph",
        thread_id="agent:chat-1",
        chat_session_id="chat-1",
        query_context={"style_retrieval_query": "quiet luxury coat"},
        runtime_plan={"hard_filters": [{"dimension": "brand", "value": "the row"}]},
    )

    result = RetrievalSessionEngine().start_collection(ctx, {"query": "black coat"})

    assert result.payload["retrieval_session_id"] == "retrieval-1"
    assert result.payload["total"] == 42
    assert result.payload["filters_applied"] == ["brand=the row"]
    assert result.search_session["retrieval_session_id"] == "retrieval-1"
    assert result.search_session["active"] is True


def test_add_filter_updates_persisted_session(monkeypatch):
    monkeypatch.setattr(engine_module, "get_qdrant", lambda: object())
    monkeypatch.setattr(engine_module, "count_session", lambda client, session, **kwargs: 12)
    monkeypatch.setattr(engine_module, "replace_retrieval_session_filters", lambda *args, **kwargs: None)
    monkeypatch.setattr(
        engine_module,
        "get_retrieval_session",
        lambda retrieval_session_id: {
            "id": retrieval_session_id,
            "actor_type": "user",
            "actor_id": "7",
            "user_id": 7,
            "query": "coat",
            "vector_type": "fashion_clip",
            "q_emb": [0.1, 0.2],
            "active_filters": [{"type": "meta", "key": "brand", "value": "the row", "dimension": "brand"}],
        },
    )
    monkeypatch.setattr(
        engine_module,
        "update_retrieval_session",
        lambda retrieval_session_id, **kwargs: {
            "id": retrieval_session_id,
            "actor_type": "user",
            "actor_id": "7",
            "user_id": 7,
            "active_filters": kwargs.get("active_filters", []),
        },
    )

    ctx = ToolExecutionContext(actor=ToolActor(user_id=7), source="mcp")
    result = RetrievalSessionEngine().add_filter(
        ctx,
        {"retrieval_session_id": "retrieval-2", "dimension": "quarter", "value": "fw"},
    )

    assert result.payload["retrieval_session_id"] == "retrieval-2"
    assert result.payload["action"] == "filter_added"
    assert "quarter=秋冬" in result.payload["active_filters"]
    assert len(result.search_session["filters"]) == 2


def test_show_collection_creates_artifact_when_chat_session_present(monkeypatch):
    monkeypatch.setattr(engine_module, "get_qdrant", lambda: object())
    monkeypatch.setattr(engine_module, "count_session", lambda client, session, **kwargs: 88)
    monkeypatch.setattr(
        engine_module,
        "get_retrieval_session",
        lambda retrieval_session_id: {
            "id": retrieval_session_id,
            "actor_type": "user",
            "actor_id": "5",
            "user_id": 5,
            "query": "minimal dress",
            "vector_type": "fashion_clip",
            "q_emb": [0.1, 0.2],
            "active_filters": [{"type": "category", "key": "category", "value": "dress", "dimension": "category"}],
        },
    )
    monkeypatch.setattr(engine_module, "create_artifact", lambda **kwargs: {"id": "artifact-9"})
    monkeypatch.setattr(
        engine_module,
        "update_retrieval_session",
        lambda retrieval_session_id, **kwargs: {"id": retrieval_session_id, "search_artifact_ref": kwargs.get("search_artifact_ref")},
    )

    ctx = ToolExecutionContext(actor=ToolActor(user_id=5), source="langgraph", chat_session_id="chat-9")
    result = RetrievalSessionEngine().show_collection(ctx, {"retrieval_session_id": "retrieval-9"})

    assert result.payload["action"] == "show_collection"
    assert result.payload["search_request_id"] == "artifact-9"
    assert result.payload["retrieval_session_id"] == "retrieval-9"
    assert result.payload["filters_applied"] == ["category=dress"]


def test_remove_filter_uses_explicit_retrieval_session_id(monkeypatch):
    monkeypatch.setattr(engine_module, "get_qdrant", lambda: object())
    monkeypatch.setattr(engine_module, "count_session", lambda client, session, **kwargs: 30)
    monkeypatch.setattr(engine_module, "replace_retrieval_session_filters", lambda *args, **kwargs: None)
    monkeypatch.setattr(
        engine_module,
        "get_retrieval_session",
        lambda retrieval_session_id: {
            "id": retrieval_session_id,
            "actor_type": "user",
            "actor_id": "3",
            "user_id": 3,
            "query": "coat",
            "vector_type": "fashion_clip",
            "q_emb": [0.1, 0.2],
            "active_filters": [
                {"type": "meta", "key": "brand", "value": "the row", "dimension": "brand"},
                {"type": "meta", "key": "quarter", "value": "秋冬", "dimension": "quarter"},
            ],
        },
    )
    monkeypatch.setattr(
        engine_module,
        "update_retrieval_session",
        lambda retrieval_session_id, **kwargs: {"id": retrieval_session_id, "active_filters": kwargs.get("active_filters", [])},
    )

    ctx = ToolExecutionContext(actor=ToolActor(user_id=3), source="mcp")
    result = RetrievalSessionEngine().remove_filter(
        ctx,
        {"retrieval_session_id": "retrieval-3", "dimension": "brand"},
    )

    assert result.payload["retrieval_session_id"] == "retrieval-3"
    assert result.payload["action"] == "filter_removed"
    assert result.payload["removed"] == ["brand=the row"]
    assert result.search_session["filters"] == [{"type": "meta", "key": "quarter", "value": "秋冬", "dimension": "quarter"}]


def test_agent_owned_session_round_trip(monkeypatch):
    monkeypatch.setattr(engine_module, "get_qdrant", lambda: object())
    monkeypatch.setattr(engine_module, "encode_text", lambda text, cancel_check=None: [0.1, 0.3])
    monkeypatch.setattr(engine_module, "apply_aesthetic_boost", lambda vector: vector)
    monkeypatch.setattr(engine_module, "count_session", lambda client, session, **kwargs: 18)
    monkeypatch.setattr(engine_module, "replace_retrieval_session_filters", lambda *args, **kwargs: None)

    sessions: dict[str, dict] = {}

    def create_session(**kwargs):
        record = {
            "id": "retrieval-agent-1",
            "actor_type": kwargs["actor_type"],
            "actor_id": kwargs["actor_id"],
            "user_id": kwargs["user_id"],
            "query": kwargs["query"],
            "vector_type": kwargs["vector_type"],
            "q_emb": kwargs["q_emb"],
            "active_filters": kwargs["active_filters"],
        }
        sessions[record["id"]] = record
        return record

    def get_session(retrieval_session_id):
        return sessions.get(retrieval_session_id)

    def update_session(retrieval_session_id, **kwargs):
        sessions[retrieval_session_id] = {
            **sessions[retrieval_session_id],
            **kwargs,
        }
        return sessions[retrieval_session_id]

    monkeypatch.setattr(engine_module, "create_retrieval_session", create_session)
    monkeypatch.setattr(engine_module, "get_retrieval_session", get_session)
    monkeypatch.setattr(engine_module, "update_retrieval_session", update_session)

    ctx = ToolExecutionContext(actor=ToolActor(agent_id="openclaw"), source="mcp")
    started = RetrievalSessionEngine().start_collection(ctx, {"query": "camel coat"})
    assert started.payload["retrieval_session_id"] == "retrieval-agent-1"
    assert sessions["retrieval-agent-1"]["actor_type"] == "agent"
    assert sessions["retrieval-agent-1"]["actor_id"] == "openclaw"

    shown = RetrievalSessionEngine().show_collection(ctx, {"retrieval_session_id": "retrieval-agent-1"})
    assert shown.payload["retrieval_session_id"] == "retrieval-agent-1"

    unauthorized_ctx = ToolExecutionContext(actor=ToolActor(agent_id="fashion-report"), source="mcp")
    try:
        RetrievalSessionEngine().show_collection(unauthorized_ctx, {"retrieval_session_id": "retrieval-agent-1"})
    except engine_module.RetrievalSessionEngineError as exc:
        assert exc.status_code == 403
    else:
        raise AssertionError("expected unauthorized access to fail")
