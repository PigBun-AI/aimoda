import pytest

from backend.app.routers import chat as chat_router


@pytest.mark.asyncio
async def test_restore_agent_session_from_history_ignores_old_thread_version(monkeypatch):
    restored_sessions: list[dict] = []

    monkeypatch.setattr(chat_router, "get_artifact", lambda *_args, **_kwargs: {
        "metadata": {
            "search_session": {
                "query": "old query",
                "vector_type": "fashion_clip",
                "q_emb": [0.1],
                "filters": [{"type": "meta", "key": "quarter", "value": "秋冬"}],
                "active": True,
            }
        }
    })
    monkeypatch.setattr(chat_router, "set_agent_session", lambda _config, session: restored_sessions.append(session))
    monkeypatch.setattr(chat_router, "update_session_semantics", lambda **_kwargs: None)
    monkeypatch.setattr(chat_router, "remember_session_style", lambda *_args, **_kwargs: None)

    history = [
        {
            "metadata": {"thread_version": 1},
            "content": [
                {
                    "type": "tool_result",
                    "content": '{"action":"show_collection","search_request_id":"artifact-old"}',
                }
            ],
        }
    ]

    restored = await chat_router._restore_agent_session_from_history(
        "user:session:v2",
        history,
        thread_version=2,
    )

    assert restored is None
    assert restored_sessions == []
