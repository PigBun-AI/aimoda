from types import SimpleNamespace
from unittest.mock import patch

from backend.app.agent import session_state


def setup_function():
    session_state._available_values_cache.clear()


class _FacetClient:
    def __init__(self, hits):
        self.hits = hits
        self.facet_calls = 0

    def facet(self, **kwargs):
        self.facet_calls += 1
        return SimpleNamespace(hits=self.hits)


def test_available_values_uses_direct_facet_for_brand():
    client = _FacetClient(
        [
            SimpleNamespace(value="akris", count=7),
            SimpleNamespace(value="dior", count=5),
        ]
    )

    with patch("backend.app.agent.session_state.get_collection", return_value="fashion_items"):
        values = session_state.available_values(client, "brand", current_filters=[])

    assert values == [
        {"value": "akris", "count": 7},
        {"value": "dior", "count": 5},
    ]
    assert client.facet_calls == 1


def test_available_values_infers_single_category_for_garment_dimensions():
    points = [
        SimpleNamespace(payload={"garments": [{"category": "dress", "colors": [{"name": "red"}]}]}),
        SimpleNamespace(payload={"garments": [{"category": "dress", "colors": [{"name": "black"}]}]}),
        SimpleNamespace(payload={"garments": [{"category": "heels", "colors": [{"name": "silver"}]}]}),
    ]
    client = SimpleNamespace(count=lambda **kwargs: SimpleNamespace(count=3))
    current_filters = [{"type": "category", "value": "dress"}]

    with patch("backend.app.agent.session_state.get_collection", return_value="fashion_items"), patch(
        "backend.app.agent.session_state.iter_scroll",
        return_value=iter(points),
    ):
        values = session_state.available_values(client, "color", current_filters=current_filters)

    assert values == [
        {"value": "red", "count": 1},
        {"value": "black", "count": 1},
    ]


def test_available_values_nested_scan_is_bounded_and_aggregated():
    points = [
        SimpleNamespace(payload={"garments": [{"category": "dress", "collar": "boat neck"}]}),
        SimpleNamespace(payload={"garments": [{"category": "dress", "collar": "boat neck"}]}),
        SimpleNamespace(payload={"garments": [{"category": "dress", "collar": "v-neck"}]}),
    ]
    client = SimpleNamespace(count=lambda **kwargs: SimpleNamespace(count=10_000))
    observed: dict[str, int] = {}

    def _fake_iter_scroll(*args, **kwargs):
        observed["max_results"] = kwargs["max_results"]
        return iter(points)

    with patch("backend.app.agent.session_state.get_collection", return_value="fashion_items"), patch(
        "backend.app.agent.session_state.iter_scroll",
        side_effect=_fake_iter_scroll,
    ):
        values = session_state.available_values(
            client,
            "collar",
            category="dress",
            current_filters=[{"type": "category", "value": "dress"}],
        )

    assert observed["max_results"] == session_state.AVAILABLE_VALUES_SCAN_CAP
    assert values == [
        {"value": "boat neck", "count": 2},
        {"value": "v-neck", "count": 1},
    ]


def test_available_values_uses_ttl_cache_for_identical_requests():
    client = _FacetClient([SimpleNamespace(value="akris", count=7)])
    current_filters = [{"type": "meta", "key": "quarter", "value": "fw"}]

    with patch("backend.app.agent.session_state.get_collection", return_value="fashion_items"):
        first = session_state.available_values(client, "brand", current_filters=current_filters)
        second = session_state.available_values(client, "brand", current_filters=current_filters)

    assert first == second
    assert client.facet_calls == 1
