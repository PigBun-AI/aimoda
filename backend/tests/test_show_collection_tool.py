import json
from types import SimpleNamespace

from backend.app.agent import tools as agent_tools
from backend.app.agent.sse import extract_images_from_json


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
    monkeypatch.setattr(agent_tools, "count_session", lambda client, session, **kwargs: 1234)
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
    assert "sample_images" not in payload
    assert "paginated results" in payload["message"]


def test_explore_colors_returns_results_without_legacy_sample_images(monkeypatch):
    monkeypatch.setattr(agent_tools, "get_collection", lambda: "fashion")
    monkeypatch.setattr(agent_tools, "get_qdrant", lambda: object())
    monkeypatch.setattr(agent_tools, "build_qdrant_filter", lambda **kwargs: object())
    monkeypatch.setattr(
        agent_tools,
        "scroll_all",
        lambda *args, **kwargs: [
            SimpleNamespace(
                payload={
                    "image_url": "https://example.com/look-1.jpg",
                    "image_id": "look-1",
                    "brand": "The Row",
                    "style": "minimal luxury",
                    "garments": [
                        {
                            "colors": [
                                {"hex": "#ff0000", "name": "scarlet"},
                                {"hex": "#111111", "name": "black"},
                            ]
                        }
                    ],
                }
            )
        ],
    )
    monkeypatch.setattr(
        agent_tools,
        "color_matches",
        lambda hexes, color: color == "red" and "#ff0000" in hexes,
    )

    result = agent_tools.explore_colors.func("red", config={"configurable": {"thread_id": "agent:session-1"}})
    payload = json.loads(result)

    assert payload["target_color"] == "red"
    assert payload["total_matching_images"] == 1
    assert "sample_images" not in payload
    assert payload["results"][0]["image_id"] == "look-1"


def test_extract_images_from_json_ignores_legacy_sample_images_payload():
    images, meta = extract_images_from_json(
        json.dumps(
            {
                "action": "show_collection",
                "total": 12,
                "search_request_id": "artifact-1",
                "sample_images": [
                    {
                        "image_url": "https://example.com/legacy.jpg",
                        "image_id": "legacy-1",
                        "brand": "Legacy",
                    }
                ],
            }
        )
    )

    assert images == []
    assert meta["total"] == 12
    assert meta["search_request_id"] == "artifact-1"
