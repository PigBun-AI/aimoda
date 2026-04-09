from app.services import favorite_service


def test_annotate_catalog_image_results_injects_favorite_state(monkeypatch):
    def fake_get_collection_ids_by_image_ids(user_id: int, image_ids: list[str]):
        assert user_id == 7
        assert image_ids == ["img-1", "img-2"]
        return {
            "img-1": ["collection-a", "collection-b"],
        }

    monkeypatch.setattr(
        favorite_service.favorite_repo,
        "get_collection_ids_by_image_ids",
        fake_get_collection_ids_by_image_ids,
    )

    images = [
        {"image_id": "img-1", "image_url": "https://example.com/1.jpg"},
        {"image_id": "img-2", "image_url": "https://example.com/2.jpg"},
    ]

    annotated = favorite_service.annotate_catalog_image_results(7, images)

    assert annotated[0]["is_favorited"] is True
    assert annotated[0]["favorite_collection_ids"] == ["collection-a", "collection-b"]
    assert annotated[1]["is_favorited"] is False
    assert annotated[1]["favorite_collection_ids"] == []
