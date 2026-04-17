from types import SimpleNamespace

import pytest

from backend.app.services import taste_profile_service
from backend.app.value_normalization import normalize_brand_key


class _FacetClient:
    def __init__(self, hits, scroll_batches_by_brand):
        self._hits = hits
        self._scroll_batches_by_brand = {
            key: list(value)
            for key, value in scroll_batches_by_brand.items()
        }
        self.facet_calls = 0
        self.scroll_calls = 0

    def facet(self, **kwargs):
        self.facet_calls += 1
        return SimpleNamespace(hits=self._hits)

    def scroll(self, **kwargs):
        self.scroll_calls += 1
        brand_values = kwargs["scroll_filter"].must[0].match.any
        brand_key = "|".join(sorted(str(value) for value in brand_values))
        batches = self._scroll_batches_by_brand.get(brand_key, [])
        if not batches:
            return [], None
        batch = batches.pop(0)
        next_offset = None if not batches else f"cursor:{self.scroll_calls}"
        return batch, next_offset


class _ScrollPoint:
    def __init__(self, vector: list[float], vector_type: str = "fashion_clip"):
        self.vector = {vector_type: vector}


def test_normalize_brand_key_collapses_case_spacing_and_punctuation():
    assert normalize_brand_key(" Tod's ") == "tods"
    assert normalize_brand_key("MM6 Maison Margiela") == "mm6maisonmargiela"
    assert normalize_brand_key("bottega Veneta") == "bottegaveneta"
    assert normalize_brand_key("Alaïa") == "alaia"


def test_build_system_taste_profile_uses_all_scroll_batches_without_sample_cap(monkeypatch):
    monkeypatch.setattr(
        taste_profile_service,
        "_load_system_dna_brand_order",
        lambda: {"prada": 0, "alaia": 1},
    )
    monkeypatch.setattr(taste_profile_service, "get_qdrant_collection_name", lambda: "fashion_items")
    client = _FacetClient(
        hits=[
            SimpleNamespace(value="Prada", count=12),
            SimpleNamespace(value="Alaïa", count=8),
        ],
        scroll_batches_by_brand={
            "Prada": [
                [_ScrollPoint([1.0, 0.0]), _ScrollPoint([1.0, 0.0])],
                [_ScrollPoint([1.0, 0.0])],
            ],
            "Alaïa": [
                [_ScrollPoint([0.0, 1.0]), _ScrollPoint([0.0, 1.0])],
            ],
        },
    )
    monkeypatch.setattr(taste_profile_service, "get_qdrant", lambda: client)

    profile, vector_type, metadata = taste_profile_service.build_system_taste_profile(preferred_vector_type="fashion_clip")

    assert vector_type == "fashion_clip"
    assert profile == pytest.approx([0.7071067811865475, 0.7071067811865475], rel=1e-6)
    assert metadata["matched_brand_count"] == 2
    assert metadata["matched_image_count"] == 5
    assert client.facet_calls == 1
    assert client.scroll_calls == 3


def test_get_system_taste_profile_reads_persisted_profile(monkeypatch):
    taste_profile_service.clear_system_taste_profile_cache()
    monkeypatch.setattr(
        taste_profile_service.system_taste_profile_repo,
        "get_system_taste_profile",
        lambda: {
            "profile_status": "ready",
            "profile_vector": [0.3, 0.4],
            "profile_vector_type": "fashion_clip",
        },
    )

    profile, vector_type = taste_profile_service.get_system_taste_profile(preferred_vector_type="fashion_clip")

    assert vector_type == "fashion_clip"
    assert profile == pytest.approx([0.6, 0.8], rel=1e-6)


def test_apply_taste_profile_to_query_blends_raw_query_with_system_dna_by_default(monkeypatch):
    monkeypatch.setattr(
        taste_profile_service,
        "get_system_taste_profile",
        lambda preferred_vector_type=None: ([0.0, 1.0], "fashion_clip"),
    )
    monkeypatch.setattr(
        taste_profile_service,
        "get_taste_profile",
        lambda user_id, taste_profile_id: ([1.0, 0.0], "fashion_clip"),
    )

    vector, vector_type = taste_profile_service.apply_taste_profile_to_query(
        user_id=7,
        taste_profile_id=None,
        query_vector=[1.0, 0.0],
        query_vector_type="fashion_clip",
        system_blend_weight=0.2,
    )

    assert vector_type == "fashion_clip"
    assert vector == pytest.approx([0.9701425001453319, 0.24253562503633297], rel=1e-6)


def test_apply_taste_profile_to_query_uses_user_dna_instead_of_system_when_selected(monkeypatch):
    monkeypatch.setattr(
        taste_profile_service,
        "get_system_taste_profile",
        lambda preferred_vector_type=None: ([0.0, 1.0], "fashion_clip"),
    )
    monkeypatch.setattr(
        taste_profile_service,
        "get_taste_profile",
        lambda user_id, taste_profile_id: ([1.0, 0.0], "fashion_clip"),
    )

    vector, vector_type = taste_profile_service.apply_taste_profile_to_query(
        user_id=7,
        taste_profile_id="dna-1",
        query_vector=[0.0, 1.0],
        query_vector_type="fashion_clip",
        blend_weight=0.5,
        system_blend_weight=0.9,
    )

    assert vector_type == "fashion_clip"
    assert vector == pytest.approx([0.7071067811865475, 0.7071067811865475], rel=1e-6)


def test_apply_taste_profile_to_query_does_not_invent_query_from_preferences(monkeypatch):
    monkeypatch.setattr(
        taste_profile_service,
        "get_system_taste_profile",
        lambda preferred_vector_type=None: ([0.0, 1.0], "fashion_clip"),
    )
    monkeypatch.setattr(
        taste_profile_service,
        "get_taste_profile",
        lambda user_id, taste_profile_id: ([1.0, 0.0], "fashion_clip"),
    )

    vector, vector_type = taste_profile_service.apply_taste_profile_to_query(
        user_id=7,
        taste_profile_id="dna-1",
        query_vector=None,
        query_vector_type=None,
    )

    assert vector is None
    assert vector_type is None


def test_rerank_image_candidates_is_now_a_no_op():
    candidates = [{"image_id": "img-1"}, {"image_id": "img-2"}]
    assert taste_profile_service.rerank_image_candidates(7, "dna-1", candidates) is candidates
