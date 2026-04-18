import pytest

from backend.app.models import AuthenticatedUser
from backend.app.routers import chat as chat_router


def _user() -> AuthenticatedUser:
    return AuthenticatedUser(
        id=7,
        email="viewer@aimoda.ai",
        role="viewer",
        session_id=88,
    )


@pytest.mark.asyncio
async def test_search_session_endpoint_uses_total_count_and_paged_results(monkeypatch):
    records = [
        type(
            "Point",
            (),
            {
                "payload": {"image_id": f"img-{index + 1}", "brand": "unknown"},
                "score": 1.0 - (index / 2000),
            },
        )()
        for index in range(240)
    ]

    monkeypatch.setattr(
        chat_router,
        "get_artifact",
        lambda artifact_id, artifact_type=None: {
            "session_id": "chat-session-1",
            "metadata": {
                "search_session": {
                    "query": "smart casual",
                    "vector_type": "fashion_clip",
                    "q_emb": [0.1, 0.2],
                    "filters": [],
                    "active": True,
                }
            },
        },
    )
    monkeypatch.setattr(chat_router, "get_session", lambda session_id: {"user_id": 7})
    monkeypatch.setattr(chat_router, "get_qdrant", lambda: object())
    monkeypatch.setattr(chat_router, "count_session", lambda client, session: 1234)
    monkeypatch.setattr(chat_router, "get_session_page", lambda client, session, offset=0, limit=20: records[offset:offset + limit])
    monkeypatch.setattr(
        chat_router,
        "format_result",
        lambda payload, score=0: {
            "image_id": payload["image_id"],
            "image_url": f"https://example.com/{payload['image_id']}.jpg",
            "score": score,
            "garments_raw": [],
            "extracted_colors_raw": [],
        },
    )

    req = chat_router.SearchSessionRequest(search_request_id="artifact-1", offset=200, limit=20)
    response = await chat_router.search_session_endpoint(req, _user())

    assert response["total"] == 1234
    assert response["offset"] == 200
    assert response["limit"] == 20
    assert response["has_more"] is True
    assert len(response["images"]) == 20
    assert response["images"][0]["image_id"] == "img-201"
    assert response["images"][-1]["image_id"] == "img-220"
