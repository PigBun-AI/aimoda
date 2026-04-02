from types import SimpleNamespace

from backend.app.services import style_knowledge_service as service


def _sample_style() -> dict:
    return {
        "style_name": "quiet luxury",
        "aliases": ["老钱风", "静奢风"],
        "category": "luxury",
        "confidence": 0.91,
        "visual_description": (
            "understated elegance with neutral camel and ivory tones, soft tailoring, "
            "refined drape, clean lines, and luxurious wool, silk, and cashmere textures"
        ),
        "palette": ["camel", "ivory", "beige", "soft black"],
        "silhouette": ["soft tailoring", "relaxed straight", "clean waist emphasis"],
        "fabric": ["wool", "silk", "cashmere"],
        "details": ["minimal trims", "clean neckline", "quiet polish"],
        "reference_brands": ["Loro Piana", "The Row", "Brunello Cucinelli"],
        "season_relevance": ["fall", "spring"],
        "gender": "women",
    }


def _point(payload: dict, score: float | None = None):
    return SimpleNamespace(payload=payload, score=score)


def test_build_style_retrieval_plan_extracts_semantic_and_filter_cues():
    plan = service.build_style_retrieval_plan(_sample_style(), user_query="老钱风连衣裙")

    assert "palette:" in plan["retrieval_query_en"]
    assert "silhouette:" in plan["retrieval_query_en"]
    assert plan["suggested_filters"]["fabric"] == ["wool", "silk", "cashmere"]
    assert plan["suggested_filters"]["gender"] == "women"
    assert "reference_brands" in plan["soft_constraints"]


def test_search_style_knowledge_prefers_exact_match(monkeypatch):
    style = _sample_style()

    monkeypatch.setattr(service, "_search_exact", lambda query, limit: [_point(style)])
    monkeypatch.setattr(service, "_search_fuzzy", lambda query, limit: [])
    monkeypatch.setattr(service, "_search_semantic", lambda query, limit: [])

    payload = service.search_style_knowledge("老钱风", limit=3)

    assert payload["status"] == "ok"
    assert payload["search_stage"] == "exact"
    assert payload["primary_style"]["style_name"] == "quiet luxury"
    assert payload["primary_style"]["match_type"] == "alias_exact"
    assert payload["retrieval_plan"]["retrieval_query_en"]


def test_search_style_knowledge_falls_back_to_semantic(monkeypatch):
    style = _sample_style()

    monkeypatch.setattr(service, "_search_exact", lambda query, limit: [])
    monkeypatch.setattr(service, "_search_fuzzy", lambda query, limit: [])
    monkeypatch.setattr(service, "_search_semantic", lambda query, limit: [_point(style, score=0.82)])

    payload = service.search_style_knowledge("低调奢华感", limit=3)

    assert payload["status"] == "ok"
    assert payload["search_stage"] == "semantic"
    assert payload["primary_style"]["score"] == 0.82
    assert payload["style_features"]["palette"][0] == "camel"
