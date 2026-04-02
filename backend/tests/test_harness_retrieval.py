from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import json

import pytest

from app.agent import harness, query_context, session_state, tools


@pytest.fixture(autouse=True)
def clear_runtime_state():
    harness._turn_contexts.clear()
    harness._session_semantics.clear()
    query_context._contexts.clear()
    query_context._session_image_contexts.clear()
    query_context._session_image_blocks.clear()
    session_state._sessions.clear()
    yield
    harness._turn_contexts.clear()
    harness._session_semantics.clear()
    query_context._contexts.clear()
    query_context._session_image_contexts.clear()
    query_context._session_image_blocks.clear()
    session_state._sessions.clear()


def test_infer_categories_from_text_detects_dress():
    inferred = harness.infer_categories_from_text("我想找蓝色的娃娃领连衣裙")
    assert "dress" in inferred


def test_add_filter_uses_turn_context_category_when_missing(monkeypatch):
    config = {"configurable": {"thread_id": "user-1:session-1"}}
    session_state.set_session(config, {
        "query": "",
        "vector_type": "fashion_clip",
        "q_emb": [0.1, 0.2, 0.3],
        "filters": [],
        "active": True,
    })
    harness.set_turn_context(
        "user-1:session-1",
        harness.build_turn_context(query_text="我想找娃娃领的连衣裙", has_images=False),
    )

    monkeypatch.setattr(tools, "get_qdrant", lambda: object())
    monkeypatch.setattr(tools, "count_session", lambda client, session: 18)

    payload = json.loads(tools.add_filter.func("collar", "peter pan collar", config=config))
    stored = session_state.get_session(config)["filters"][0]

    assert payload["action"] == "filter_added"
    assert payload["resolved_category"] == "dress"
    assert "(on dress)" in payload["filter"]
    assert stored["type"] == "garment_attr"
    assert stored["key"] == "dress:collar"


def test_add_filter_returns_structured_error_when_category_still_unknown(monkeypatch):
    config = {"configurable": {"thread_id": "user-2:session-2"}}
    session_state.set_session(config, {
        "query": "",
        "vector_type": "fashion_clip",
        "q_emb": [0.1, 0.2, 0.3],
        "filters": [],
        "active": True,
    })

    monkeypatch.setattr(tools, "get_qdrant", lambda: object())

    payload = json.loads(tools.add_filter.func("collar", "peter pan collar", config=config))

    assert payload["error_type"] == "invalid_filter_request"
    assert payload["retry_same_call"] is False
    assert "category" in payload["error"]


def test_add_filter_rejects_abstract_style_dimension(monkeypatch):
    config = {"configurable": {"thread_id": "user-3:session-3"}}
    session_state.set_session(config, {
        "query": "",
        "vector_type": "fashion_clip",
        "q_emb": [0.1, 0.2, 0.3],
        "filters": [],
        "active": True,
    })

    payload = json.loads(tools.add_filter.func("style", "commute", config=config))

    assert payload["error_type"] == "unsupported_dimension"
    assert payload["retry_same_call"] is False
    assert "richer query" in payload["error"]


def test_search_style_tool_returns_retrieval_plan(monkeypatch):
    monkeypatch.setattr(tools, "search_style_knowledge", lambda query, limit=3: {
        "status": "ok",
        "query": query,
        "search_stage": "exact",
        "message": "Found a style match.",
        "primary_style": {
            "style_name": "quiet luxury",
            "aliases": ["老钱风"],
            "category": "luxury",
            "confidence": 0.91,
            "match_type": "alias_exact",
        },
        "alternatives": [],
        "style_features": {
            "visual_description_en": "understated elegance",
            "palette": ["camel"],
            "silhouette": ["soft tailoring"],
            "fabric": ["wool"],
            "details": ["minimal trims"],
            "reference_brands": ["Loro Piana"],
            "season_relevance": ["fall"],
            "gender": "women",
        },
        "retrieval_plan": {
            "retrieval_query_en": "understated elegance, palette: camel",
            "semantic_boost_terms": ["soft tailoring", "wool"],
            "suggested_filters": {"fabric": ["wool"]},
            "soft_constraints": {"palette": ["camel"]},
            "agent_guidance": {"recommended_next_step": "start_collection"},
        },
        "fallback_suggestion": None,
    })

    payload = json.loads(tools.search_style.func("老钱风", limit=3))

    assert payload["status"] == "ok"
    assert payload["primary_style"]["style_name"] == "quiet luxury"
    assert payload["retrieval_plan"]["retrieval_query_en"] == "understated elegance, palette: camel"
