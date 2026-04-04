import json

from backend.app.agent import tools as agent_tools


def test_show_collection_uses_total_count_for_paginated_semantic_sessions(monkeypatch):
    monkeypatch.setattr(
        agent_tools,
        "get_session",
        lambda config: {
            "query": "sophisticated casual",
            "vector_type": "fashion_clip",
            "q_emb": [0.1, 0.2],
            "filters": [],
            "active": True,
        },
    )
    monkeypatch.setattr(agent_tools, "get_qdrant", lambda: object())
    monkeypatch.setattr(agent_tools, "count_session", lambda client, session: 1234)
    monkeypatch.setattr(
        agent_tools,
        "get_session_page",
        lambda client, session, offset=0, limit=8: [
            type("Point", (), {"payload": {"image_id": "img-1", "image_url": "https://example.com/1.jpg"}, "score": 0.98})(),
            type("Point", (), {"payload": {"image_id": "img-2", "image_url": "https://example.com/2.jpg"}, "score": 0.97})(),
        ],
    )
    monkeypatch.setattr(
        agent_tools,
        "format_result",
        lambda payload, score=0: {
            "image_id": payload["image_id"],
            "image_url": payload["image_url"],
            "score": score,
        },
    )
    monkeypatch.setattr(agent_tools, "create_artifact", lambda **kwargs: {"id": "artifact-1"})

    result = agent_tools.show_collection.func(config={"configurable": {"thread_id": "agent:session-1"}})
    payload = json.loads(result)

    assert payload["action"] == "show_collection"
    assert payload["total"] == 1234
    assert payload["search_request_id"] == "artifact-1"
    assert len(payload["sample_images"]) == 2
    assert "paginated results" in payload["message"]

