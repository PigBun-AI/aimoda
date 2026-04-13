from types import SimpleNamespace

import pytest

from backend.app.models import AuthenticatedUser
from backend.app.routers import chat as chat_router


class _CountResult:
    def __init__(self, count: int):
        self.count = count


class _Point:
    def __init__(self, payload: dict, score: float = 0.0):
        self.payload = payload
        self.score = score


class _CursorScrollClient:
    def __init__(self, records: list[dict]):
        self.records = records
        self.cursor_by_index: dict[int, str] = {}
        self.index_by_cursor: dict[str, int] = {}

    def scroll(
        self,
        *,
        collection_name,
        scroll_filter,
        limit,
        offset=None,
        with_payload=True,
    ):
        if offset is None:
            start = 0
        elif isinstance(offset, str):
            start = self.index_by_cursor[offset]
        else:
            # Match the real Qdrant bug vector: integer offsets are treated as point IDs,
            # so page-based callers end up reading the first page again.
            start = 0
        batch = self.records[start:start + limit]
        next_offset = start + len(batch)
        if next_offset >= len(self.records):
            next_offset = None
        else:
            cursor = self.cursor_by_index.get(next_offset)
            if cursor is None:
                cursor = f"cursor:{next_offset}"
                self.cursor_by_index[next_offset] = cursor
                self.index_by_cursor[cursor] = next_offset
            next_offset = cursor
        points = [_Point(payload=item) for item in batch] if with_payload else [object()] * len(batch)
        return points, next_offset

    def count(self, *, collection_name, count_filter, exact):
        return _CountResult(len(self.records))


@pytest.mark.asyncio
async def test_search_similar_brand_pagination_uses_scroll_page_offset(monkeypatch):
    records = [
        {"image_id": f"look-{index}", "brand": "akris", "year": 2026}
        for index in range(30)
    ]
    client = _CursorScrollClient(records)

    monkeypatch.setattr(chat_router, "get_qdrant", lambda: client)
    monkeypatch.setattr(chat_router, "get_collection", lambda: "fashion_items")

    from backend.app.agent import qdrant_utils

    monkeypatch.setattr(qdrant_utils, "build_qdrant_filter", lambda **kwargs: SimpleNamespace())
    monkeypatch.setattr(qdrant_utils, "format_result", lambda payload, score=0: dict(payload))

    response = await chat_router.search_similar_endpoint(
        chat_router.SearchSimilarRequest(
            brand="akris",
            page=2,
            page_size=15,
        ),
        user=AuthenticatedUser(id=1, role="viewer"),
    )

    assert response["page"] == 2
    assert response["page_size"] == 15
    assert response["total"] == 30
    assert [item["image_id"] for item in response["images"]] == [f"look-{index}" for index in range(15, 30)]
    assert response["has_more"] is False


@pytest.mark.asyncio
async def test_search_similar_forwards_quarter_filter(monkeypatch):
    client = _CursorScrollClient([{"image_id": "look-1", "brand": "akris", "year": 2026}])
    captured: dict[str, object] = {}

    monkeypatch.setattr(chat_router, "get_qdrant", lambda: client)
    monkeypatch.setattr(chat_router, "get_collection", lambda: "fashion_items")

    from backend.app.agent import qdrant_utils

    def _fake_build_qdrant_filter(**kwargs):
        captured.update(kwargs)
        return SimpleNamespace()

    monkeypatch.setattr(qdrant_utils, "build_qdrant_filter", _fake_build_qdrant_filter)
    monkeypatch.setattr(qdrant_utils, "format_result", lambda payload, score=0: dict(payload))

    response = await chat_router.search_similar_endpoint(
        chat_router.SearchSimilarRequest(
            brand="akris",
            quarter="fw",
            page=1,
            page_size=15,
        ),
        user=AuthenticatedUser(id=1, role="viewer"),
    )

    assert response["total"] == 1
    assert captured["quarter"] == "fw"
